import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const NAME_KEY = 'yhangswing_display_name'
const IDENTITY_KEY = 'yhangswing_identity'
const MAX_LEN = 500

// 背景音乐（public/music 目录）：优先无损 FLAC，不支持的设备自动降级 MP3
const MUSIC_SOURCES = [
  { src: '/music/count-it.flac', type: 'audio/flac' },
  { src: '/music/count-it.mp3', type: 'audio/mpeg' },
]
const MUSIC_TITLE = '满贯 (Count It)'

// ---------- 本机身份（uid + secret），用于服务端删除鉴权 ----------
function loadIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.uid && p.secret) return p
    }
  } catch { /* ignore */ }
  const id = {
    uid: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
    secret: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
  }
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(id)) } catch { /* ignore */ }
  return id
}

// ---------- 背景浮动照片（photos 文件夹随机抽取，同屏最多 6 张，围绕主卡片持续漂移换图） ----------
const BG_PHOTO_MAX = 6
const REGIONS = ['left', 'right', 'top', 'bottom']

function shuffleArr(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function FloatingPhotos() {
  const [pool, setPool] = useState([])
  const [slots, setSlots] = useState([])

  // 拉取 photos 文件夹清单（由后端扫描目录提供）；单文件导出版本用内嵌的 __BG_PHOTOS__ 兜底
  useEffect(() => {
    let cancelled = false
    const fallback = Array.isArray(window.__BG_PHOTOS__) ? window.__BG_PHOTOS__ : []
    fetch('/api/photos')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const list = Array.isArray(data?.photos) ? data.photos.filter(Boolean) : []
        if (list.length) {
          setPool(list.map(f => `/photos/${encodeURIComponent(f)}`))
        } else if (fallback.length) {
          setPool(fallback)
        }
      })
      .catch(() => {
        if (!cancelled && fallback.length) setPool(fallback)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (pool.length === 0) return
    let slotSeq = 0
    let timers = []

    const isMobile = () => window.innerWidth < 600
    const rand = (min, max) => min + Math.random() * (max - min)

    const cardRect = () => {
      const el = document.querySelector('.card')
      return el ? el.getBoundingClientRect() : null
    }

    // 两照片矩形是否重叠（含安全间距：考虑到浮动 ±9px 与 ±12° 倾斜的外接矩形放大）
    const overlaps = (a, b) => {
      const margin = 30
      return !(a.x + a.size + margin <= b.x || b.x + b.size + margin <= a.x ||
               a.y + a.size + margin <= b.y || b.y + b.size + margin <= a.y)
    }
    const collides = (rect, avoid) => avoid.some(a => overlaps(rect, a))

    // 尝试把照片放进「卡片四周」的某条空白带，完全在卡片外且不与其它照片重叠；
    // band = { index, total } 时把长轴切成多条子带，同一区域内的照片各占一条，漂移动线不交叉
    const tryRegion = (region, size, avoid, band = null) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const gap = 16 // 与卡片保持间距
      const pad = 10 // 与屏幕边缘保持间距
      const card = cardRect()
      let x0, x1, y0, y1
      if (region === 'left') {
        x0 = pad; x1 = (card ? card.left : vw) - size - gap
        y0 = pad; y1 = vh - size - pad
      } else if (region === 'right') {
        x0 = (card ? card.right : 0) + gap; x1 = vw - size - pad
        y0 = pad; y1 = vh - size - pad
      } else if (region === 'top') {
        x0 = pad; x1 = vw - size - pad
        y0 = pad; y1 = (card ? card.top : vh) - size - gap
      } else { // bottom
        x0 = pad; x1 = vw - size - pad
        y0 = (card ? card.bottom : 0) + gap; y1 = vh - size - pad
      }
      if (x1 < x0 || y1 < y0) return null

      // 子带切分：左/右区域纵向切，上/下区域横向切，保证同区域照片互不穿插
      if (band && band.total > 1) {
        if (region === 'left' || region === 'right') {
          const span = y1 - y0
          const seg = span / band.total
          y0 = y0 + seg * band.index
          y1 = y0 + seg - size
        } else {
          const span = x1 - x0
          const seg = span / band.total
          x0 = x0 + seg * band.index
          x1 = x0 + seg - size
        }
        if (x1 < x0 || y1 < y0) return null
      }

      // 多次随机找点，直到不与任何照片重叠
      for (let t = 0; t < 36; t++) {
        const p = { x: rand(x0, x1), y: rand(y0, y1), size }
        if (!collides(p, avoid)) return p
      }
      return null
    }

    // 为某个槽位选一个布局：照片在背景层（白色卡片之后），优先围绕卡片四周空白带漂浮；
    // 所有候选位置都会避开其它照片，保证 6 张互不叠在一起
    // anchor = 该照片当前位置：四周放不下时以它为锚点就近漫游，不会横穿屏幕与他人相遇
    const chooseLayout = (slotIndex, avoid = [], totalSlots = BG_PHOTO_MAX, anchor = null) => {
      const mobile = isMobile()
      const rot = rand(-12, 12)
      const bob = rand(5.5, 8).toFixed(1)
      // 每张照片错位漂移，避免集体同时移动
      const delay = ((slotIndex * 0.4) % 2.2).toFixed(2) + 's'
      const pref = REGIONS[slotIndex % REGIONS.length]
      // 与当前槽位偏好同一方位的所有槽位 → 划分该区域子带，彼此动线不交叉
      const bandMateIdx = []
      for (let k = 0; k < totalSlots; k++) {
        if (REGIONS[k % REGIONS.length] === pref) bandMateIdx.push(k)
      }
      const band = { index: bandMateIdx.indexOf(slotIndex), total: bandMateIdx.length }
      const maxSize = mobile ? 126 : 184
      const minSize = mobile ? 80 : 112

      // 方位固定：槽位始终围绕偏好方位活动，不跨区跳动（动线不与其他区域交叉）
      const order = [pref, ...REGIONS.filter(r => r !== pref)]
      let size = maxSize
      for (let attempt = 0; attempt < 6; attempt++) {
        for (const r of order) {
          const p = tryRegion(r, size, avoid, r === pref ? band : null)
          if (p) return { ...p, size, rot, bob, delay }
        }
        size = Math.round(size * 0.88)
        if (size < minSize) break
      }

      // 兜底：以当前位置为锚点就近漫游（由近到远扩大半径），照片只在附近轻轻漂移，不横穿屏幕；
      // 尺寸沿用当前照片，避免宽高跳变
      const vw = window.innerWidth
      const vh = window.innerHeight
      const fbSize = anchor?.size || (mobile ? 100 : 126)
      const ax = anchor ? anchor.x : rand(20, vw - fbSize - 20)
      const ay = anchor ? anchor.y : rand(20, vh - fbSize - 20)
      for (const radius of [90, 190, 360, null]) {
        const tries = radius === null ? 40 : 28
        for (let t = 0; t < tries; t++) {
          let x, y
          if (radius === null) {
            x = rand(10, vw - fbSize - 10)
            y = rand(10, vh - fbSize - 10)
          } else {
            x = ax + rand(-radius, radius)
            y = ay + rand(-radius, radius)
            x = Math.max(10, Math.min(vw - fbSize - 10, x))
            y = Math.max(10, Math.min(vh - fbSize - 10, y))
          }
          const p = { x, y, size: fbSize }
          if (!collides(p, avoid)) return { ...p, rot, bob, delay }
        }
      }
      // 极端拥挤时保底（几乎不会走到）
      return { x: ax, y: ay, size: mobile ? 76 : 100, rot, bob, delay }
    }

    // ---------- 洗牌队列：一次循环中每张图只出现一次，整轮轮完后才重新洗牌 ----------
    let queue = shuffleArr(pool)
    // 从队列取一张「当前同屏未展示」的图；队列耗尽则重新洗牌
    const takeSrc = (displayedSet) => {
      let idx = queue.findIndex(s => !displayedSet.has(s))
      if (idx === -1) {
        queue = shuffleArr(pool)
        idx = queue.findIndex(s => !displayedSet.has(s))
      }
      if (idx === -1) return pool[0] // 池子里只有一张图的极端情况
      return queue.splice(idx, 1)[0]
    }

    // 初始槽位：最多 6 张，来自洗牌队列（天然互不重复），摆放时依次避开已放置的照片
    const count = Math.min(BG_PHOTO_MAX, pool.length)
    const displayed = new Set()
    const placed = []
    const initial = []
    for (let i = 0; i < count; i++) {
      const src = takeSrc(displayed)
      displayed.add(src)
      const layout = chooseLayout(i, placed)
      layout.delay = '0s' // 首批立即到位
      placed.push({ x: layout.x, y: layout.y, size: layout.size })
      initial.push({ key: ++slotSeq, src, fade: false, ...layout })
    }
    setSlots(initial)
    // 淡入
    timers.push(setTimeout(() => {
      setSlots(prev => prev.map(s => ({ ...s, fade: true })))
    }, 150))

    // 持续漂移：绕主卡片到新的随机方位；逐槽位规划，新目标与其它照片（新目标或旧位置）互不重叠
    const drift = () => {
      setSlots(prev => {
        const targets = []
        return prev.map((s, i) => {
          const avoid = [
            ...targets,
            ...prev.slice(i + 1).map(t => ({ x: t.x, y: t.y, size: t.size })),
          ]
          const layout = chooseLayout(i, avoid, prev.length, { x: s.x, y: s.y, size: s.size })
          targets.push({ x: layout.x, y: layout.y, size: layout.size })
          return { ...s, ...layout }
        })
      })
    }
    // 循环换图：随机一个槽位淡出 → 原位换上新图（不瞬移、不重排，最平滑）→ 淡入
    const swapOne = () => {
      setSlots(prev => {
        if (!prev.length) return prev
        const idx = Math.floor(Math.random() * prev.length)
        const target = prev[idx]
        const next = [...prev]
        next[idx] = { ...target, fade: false }
        timers.push(setTimeout(() => {
          setSlots(cur => {
            // 应用瞬间以最新同屏图片为准取图，保证一次循环中不重复；位置保持不变
            const onScreen = new Set(cur.map(t => t.src))
            const newSrc = takeSrc(onScreen)
            return cur.map(t =>
              t.key === target.key ? { ...t, src: newSrc, fade: true } : t
            )
          })
        }, 550))
        return next
      })
    }

    timers.push(setInterval(drift, 6000))
    timers.push(setInterval(swapOne, 4600))
    window.addEventListener('resize', drift)

    return () => {
      timers.forEach(clearTimeout)
      timers.forEach(clearInterval)
      window.removeEventListener('resize', drift)
    }
  }, [pool])

  if (slots.length === 0) return null

  return (
    <div className="float-photos" aria-hidden="true">
      {slots.map(s => (
        <div
          key={s.key}
          className="float-photo"
          style={{
            width: s.size,
            height: s.size,
            opacity: s.fade ? 0.92 : 0,
            transform: `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}deg)`,
            transitionDelay: `${s.delay || '0s'}, 0s`, // 只延迟位移，淡入淡出立即生效
          }}
        >
          <span className="float-photo-bob" style={{ animationDuration: `${s.bob}s` }}>
            <img src={s.src} alt="" draggable="false" />
          </span>
        </div>
      ))}
    </div>
  )
}

function App() {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' }
  })
  const [content, setContent] = useState('')
  const [messages, setMessages] = useState([])
  const [photos, setPhotos] = useState([])
  const [connected, setConnected] = useState(false)
  const [online, setOnline] = useState(0)
  const [showGallery, setShowGallery] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  const [uploaderId, setUploaderId] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' }
  })
  const [uploading, setUploading] = useState(false)

  // 删除确认弹窗：{ kind: 'message'|'photo', id, ...预览信息 }
  const [confirmTarget, setConfirmTarget] = useState(null)

  // 入口审批弹窗：进入页面前必须先「批准」
  const [gateOpen, setGateOpen] = useState(true)
  const [gateShake, setGateShake] = useState(false)
  const [reconsiderCount, setReconsiderCount] = useState(0)

  // 音乐播放器
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const identityRef = useRef(loadIdentity())
  const socketRef = useRef(null)
  const fileInputRef = useRef(null)
  const gatePassedRef = useRef(false)

  // ---------- 音乐自动播放 ----------
  // 浏览器策略：无用户手势时 play() 可能被拒绝 → 首次点击/按键时兜底解锁
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.loop = true
    audio.volume = 0.45
    audio.load()

    // 所有音源都无法播放时提示一次（如旧设备不支持 FLAC 且 MP3 也加载失败）
    const onError = () => {
      if (audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        console.warn('🎵 音乐加载失败：当前浏览器可能不支持该音频格式')
      }
    }
    audio.addEventListener('error', onError)

    const tryPlay = () => {
      audio.play().then(() => setIsPlaying(true)).catch(() => {
        const unlock = () => {
          // 入口审批未通过前不播放（点「再考虑一下」不应响起音乐）
          if (!gatePassedRef.current) return
          audio.play().then(() => setIsPlaying(true)).catch(() => {})
          window.removeEventListener('pointerdown', unlock)
          window.removeEventListener('keydown', unlock)
        }
        window.addEventListener('pointerdown', unlock, { once: true })
        window.addEventListener('keydown', unlock, { once: true })
      })
    }
    tryPlay()

    return () => audio.removeEventListener('error', onError)
  }, [])

  function toggleMusic() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  // ---------- 入口审批 ----------
  // 「是的」：批准 → 进入页面（本次点击是用户手势，顺便解锁音乐播放）
  function approveGate() {
    gatePassedRef.current = true
    setGateOpen(false)
    const audio = audioRef.current
    if (audio && audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {})
    }
  }

  // 「再考虑一下」：不批准 → 弹窗重复出现（抖动反馈）
  function reconsiderGate() {
    setReconsiderCount(c => c + 1)
    setGateShake(true)
    setTimeout(() => setGateShake(false), 600)
  }

  // ---------- socket 连接 & 实时事件 ----------
  useEffect(() => {
    const socket = io() // 同源；开发环境经 Vite 代理到后端
    socketRef.current = socket

    const identify = () => {
      socket.emit('identify', identityRef.current, (res) => {
        if (!res?.ok) {
          // uid 撞车（极少见）→ 重新生成身份再注册
          const fresh = {
            uid: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
            secret: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
          }
          identityRef.current = fresh
          try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(fresh)) } catch { /* ignore */ }
          socket.emit('identify', fresh)
        }
      })
    }

    socket.on('connect', () => {
      setConnected(true)
      identify()
    })
    socket.on('disconnect', () => setConnected(false))

    socket.on('init', (data) => {
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setPhotos(Array.isArray(data.photos) ? data.photos : [])
      if (typeof data.online === 'number') setOnline(data.online)
    })

    socket.on('presence', (data) => {
      if (typeof data?.online === 'number') setOnline(data.online)
    })

    socket.on('message:new', (msg) => {
      setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
    })
    socket.on('message:deleted', ({ id }) => {
      setMessages(prev => prev.filter(m => m.id !== id))
    })

    socket.on('photo:new', (photo) => {
      setPhotos(prev => (prev.some(p => p.id === photo.id) ? prev : [photo, ...prev]))
    })
    socket.on('photo:deleted', ({ id }) => {
      setPhotos(prev => prev.filter(p => p.id !== id))
    })

    socket.on('photo:error', (data) => {
      alert('😢 ' + (data?.message || '照片上传失败'))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  // 记住昵称
  useEffect(() => {
    try { localStorage.setItem(NAME_KEY, name) } catch { /* ignore */ }
  }, [name])
  useEffect(() => {
    try { localStorage.setItem(NAME_KEY, uploaderId) } catch { /* ignore */ }
  }, [uploaderId])

  // ---------- 雪花生成 ----------
  useEffect(() => {
    const container = document.getElementById('snow-container')
    if (!container) return
    container.innerHTML = ''
    const flakes = ['❄', '❅', '❆', '✦']
    for (let i = 0; i < 55; i++) {
      const el = document.createElement('div')
      el.className = 'snowflake'
      el.textContent = flakes[Math.floor(Math.random() * flakes.length)]
      const size = 14 + Math.random() * 18
      el.style.fontSize = size + 'px'
      el.style.left = Math.random() * 100 + '%'
      const duration = 6 + Math.random() * 12
      el.style.animationDuration = duration + 's'
      el.style.animationDelay = Math.random() * 10 + 's'
      el.style.opacity = 0.5 + Math.random() * 0.5
      container.appendChild(el)
    }
  }, [])

  // ---------- 留言 ----------
  function addMessage() {
    const text = content.trim()
    if (!text) {
      alert('💖 请写下你想说的话～')
      return
    }
    if (!connected) {
      alert('⏳ 正在连接服务器，请稍等片刻再发送～')
      return
    }
    socketRef.current?.emit('message:create', {
      ...identityRef.current,
      name: name.trim(),
      content: text,
    })
    setContent('')
  }

  // ---------- 删除：第一步只弹确认框，不做任何删除 ----------
  function requestDeleteMessage(msg) {
    setConfirmTarget({
      kind: 'message',
      id: msg.id,
      title: '删除这条留言？',
      preview: msg.content,
      meta: `${msg.name} · ${formatTime(msg.timestamp)}`,
    })
  }

  function requestDeletePhoto(photo) {
    setConfirmTarget({
      kind: 'photo',
      id: photo.id,
      title: '删除这张照片？',
      preview: photo.dataUrl,
      meta: `🦄 ${photo.authorId} · 📅 ${formatPhotoDate(photo.timestamp)}`,
    })
  }

  function closeConfirm() {
    setConfirmTarget(null)
  }

  // ---------- 删除：第二步，用户点击「确认删除」后才真正发送请求 ----------
  function executeDelete() {
    if (!confirmTarget) return
    if (confirmTarget.kind === 'message') {
      socketRef.current?.emit('message:delete', { ...identityRef.current, id: confirmTarget.id })
    } else {
      socketRef.current?.emit('photo:delete', { ...identityRef.current, id: confirmTarget.id })
      setLightboxIndex(-1) // 照片删除后关闭灯箱
    }
    setConfirmTarget(null)
  }

  // ---------- 相册：图片压缩 ----------
  function compressImage(file, maxSize = 1200, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.onload = e => {
        const img = new Image()
        img.onerror = () => reject(new Error('图片解析失败'))
        img.onload = () => {
          let { width, height } = img
          if (width > maxSize || height > maxSize) {
            if (width >= height) {
              height = Math.round((height * maxSize) / width)
              width = maxSize
            } else {
              width = Math.round((width * maxSize) / height)
              height = maxSize
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', quality))
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(file)
    })
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    if (!connected) {
      alert('⏳ 正在连接服务器，请稍等片刻再上传～')
      return
    }

    setUploading(true)
    try {
      for (const file of files) {
        const dataUrl = await compressImage(file)
        socketRef.current?.emit('photo:create', {
          ...identityRef.current,
          authorId: uploaderId.trim() || name.trim() || '匿名',
          dataUrl,
        })
      }
    } catch (err) {
      alert('😢 上传失败：' + (err.message || '未知错误'))
    } finally {
      setUploading(false)
    }
  }

  // ---------- 灯箱 ----------
  function openLightbox(idx) { setLightboxIndex(idx) }
  function closeLightbox() { setLightboxIndex(-1) }
  function prevImage() { setLightboxIndex(i => (i - 1 + photos.length) % photos.length) }
  function nextImage() { setLightboxIndex(i => (i + 1) % photos.length) }

  useEffect(() => {
    if (lightboxIndex === -1) return
    function onKey(e) {
      // 删除确认框打开时，ESC 交给确认框处理（关闭确认框），不动灯箱
      if (e.key === 'Escape') {
        if (document.querySelector('.confirm-overlay')) return
        closeLightbox()
      }
      else if (e.key === 'ArrowLeft') prevImage()
      else if (e.key === 'ArrowRight') nextImage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, photos.length])

  // 删除确认弹窗：ESC / Enter 键支持
  useEffect(() => {
    if (!confirmTarget) return
    function onKey(e) {
      if (e.key === 'Escape') closeConfirm()
      if (e.key === 'Enter') executeDelete()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmTarget])

  // ---------- 渲染辅助 ----------
  const myUid = identityRef.current.uid
  const sortedMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp)
  // 照片新的在前
  const sortedPhotos = [...photos].sort((a, b) => b.timestamp - a.timestamp)

  function formatTime(ts) {
    return new Date(ts).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  function formatPhotoDate(ts) {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <>
      <div id="snow-container" />

      {/* 背景浮动照片：photos 文件夹随机轮播（同屏最多 4 张，不阻挡点击） */}
      <FloatingPhotos />

      {/* ===== 入口审批弹窗（必须批准才能进入；遮罩/ESC 均不可关闭） ===== */}
      {gateOpen && (
        <div className="gate-overlay">
          <div className={`gate-dialog ${gateShake ? 'shake' : ''}`} role="dialog" aria-modal="true">
            <div className="gate-icon">💍</div>
            <h2 className="gate-question">
              你是否批准通过
              <br />
              <span className="gate-names">刘扬扬 <em>&amp;</em> 黄冠亨</span>
              <br />
              的结婚请求？
            </h2>
            {reconsiderCount > 0 && (
              <p className="gate-nudge">
                {reconsiderCount >= 3
                  ? '别考虑啦，宇宙都在等你的批准～ 🥹'
                  : '再想一想嘛，他们真的很般配～ 🥺'}
              </p>
            )}
            <div className="gate-actions">
              <button className="gate-btn approve" onClick={approveGate} autoFocus>
                是的 💖
              </button>
              <button className="gate-btn reconsider" onClick={reconsiderGate}>
                再考虑一下
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 背景音乐播放器（左上角） */}
      <audio ref={audioRef} preload="auto" loop>
        {MUSIC_SOURCES.map(s => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </audio>
      <div className="music-player">
        <button
          className={`music-btn ${isPlaying ? 'playing' : ''}`}
          onClick={toggleMusic}
          aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
          title={`${MUSIC_TITLE} — ${isPlaying ? '点击暂停' : '点击播放'}`}
        >
          <span className="music-disc">🎵</span>
        </button>
        <span className="music-label">{isPlaying ? '正在播放 · 满贯' : '播放音乐'}</span>
      </div>

      <div className="card">
        {/* 头部 */}
        <div className="header">
          <h1>扬亨的秋千宇宙</h1>
          <p>希望小羊和独角兽能带给每一个你幸福的时刻</p>
          <div className="divider" />
          <div className="status-bar">
            {connected ? (
              <span className="status-chip online">🟢 在线 · {online} 人正在宇宙里</span>
            ) : (
              <span className="status-chip offline">⚪ 正在连接服务器…</span>
            )}
          </div>
        </div>

        {/* 相册按钮 */}
        <div className="album-actions">
          <button className="btn-album" onClick={() => setShowGallery(true)}>
            📸 打开相册
          </button>
        </div>

        {/* 留言表单 */}
        <div className="form-group">
          <div className="form-row">
            <input
              type="text"
              placeholder="你的昵称 (可选)"
              maxLength={30}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  document.getElementById('msg-ta')?.focus()
                }
              }}
            />
            <button className="btn-submit" onClick={addMessage} disabled={!connected}>
              ✉️ 发表留言
            </button>
          </div>
          <div className="form-row">
            <textarea
              id="msg-ta"
              placeholder="写下你想说的话… (最多 500 字)"
              maxLength={MAX_LEN}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  addMessage()
                }
              }}
            />
          </div>
          <div className="char-counter">{content.length} / {MAX_LEN}</div>
        </div>

        {/* 留言列表 */}
        <div className="messages-section">
          <div className="messages-header">
            <h2>💬 留言板</h2>
            <span className="count">{messages.length} 条留言</span>
          </div>

          <div className="messages-list">
            {sortedMessages.length === 0 ? (
              <div className="empty-message">
                <span>🎀</span>
                {connected ? '还没有留言呢 … 快来写下第一条吧！' : '正在加载留言…'}
              </div>
            ) : (
              sortedMessages.map(msg => (
                <div key={msg.id} className="message-item">
                  <div className="meta">
                    <span className="name">
                      {msg.name}
                      {msg.uid === myUid && <span className="me-tag">我</span>}
                    </span>
                    <span className="time">{formatTime(msg.timestamp)}</span>
                    {msg.uid === myUid && (
                      <button className="delete-btn" onClick={() => requestDeleteMessage(msg)}>
                        ✕ 删除
                      </button>
                    )}
                  </div>
                  <div className="content">{msg.content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ===== 相册 Modal ===== */}
      {showGallery && (
        <div className="gallery-modal" onClick={() => setShowGallery(false)}>
          <div className="gallery-panel" onClick={e => e.stopPropagation()}>
            <div className="gallery-header">
              <h2>📸 宇宙相册</h2>
              <button className="gallery-close" onClick={() => setShowGallery(false)} aria-label="关闭相册">
                ✕
              </button>
            </div>

            {/* 上传区 */}
            <div className="upload-panel">
              <input
                type="text"
                className="upload-id-input"
                placeholder="你的 ID / 昵称（上传时标注）"
                maxLength={20}
                value={uploaderId}
                onChange={e => setUploaderId(e.target.value)}
              />
              <button
                className="btn-upload"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !connected}
              >
                {uploading ? '⏳ 上传中…' : '🖼️ 选择图片上传'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFiles}
              />
              <p className="upload-hint">支持多选 · 自动压缩 · 标注你的 ID 与上传日期 · 仅本人可删除</p>
            </div>

            {/* 照片网格 */}
            {sortedPhotos.length === 0 ? (
              <div className="empty-message gallery-empty">
                <span>🖼️</span>
                {connected ? '相册还是空的 … 快上传第一张照片吧！' : '正在加载相册…'}
              </div>
            ) : (
              <div className="gallery-grid">
                {sortedPhotos.map((photo, idx) => (
                  <div key={photo.id} className="gallery-item">
                    <button className="gallery-thumb" onClick={() => openLightbox(idx)} aria-label="查看大图">
                      <img src={photo.dataUrl} alt={`${photo.authorId} 上传的照片`} />
                    </button>
                    {photo.uid === myUid && (
                      <button className="photo-delete" onClick={() => requestDeletePhoto(photo)} aria-label="删除照片">
                        ✕
                      </button>
                    )}
                    <div className="photo-badge">
                      <span className="photo-author">
                        🦄 {photo.authorId}
                        {photo.uid === myUid && <span className="me-tag light">我</span>}
                      </span>
                      <span className="photo-date">📅 {formatPhotoDate(photo.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 灯箱 Lightbox ===== */}
      {lightboxIndex !== -1 && sortedPhotos[lightboxIndex] && (
        <div className="lightbox" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox} aria-label="关闭">✕</button>
          <button className="lightbox-nav lightbox-prev" onClick={e => { e.stopPropagation(); prevImage() }} aria-label="上一张">‹</button>
          <div className="lightbox-image-wrap" onClick={e => e.stopPropagation()}>
            <img
              src={sortedPhotos[lightboxIndex].dataUrl}
              alt={`${sortedPhotos[lightboxIndex].authorId} 上传的照片`}
            />
            <div className="lightbox-caption">
              🦄 {sortedPhotos[lightboxIndex].authorId}
              {' · '}📅 {formatPhotoDate(sortedPhotos[lightboxIndex].timestamp)}
              <span className="lightbox-index"> — {lightboxIndex + 1} / {photos.length}</span>
              {sortedPhotos[lightboxIndex].uid === myUid && (
                <button
                  className="lightbox-delete"
                  onClick={() => requestDeletePhoto(sortedPhotos[lightboxIndex])}
                >
                  🗑️ 删除这张照片
                </button>
              )}
            </div>
          </div>
          <button className="lightbox-nav lightbox-next" onClick={e => { e.stopPropagation(); nextImage() }} aria-label="下一张">›</button>
        </div>
      )}

      {/* ===== 删除确认弹窗（只有点击「确认删除」才会真正删除） ===== */}
      {confirmTarget && (
        <div className="confirm-overlay" onClick={closeConfirm}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className="confirm-icon">{confirmTarget.kind === 'photo' ? '🖼️' : '💬'}</div>
            <h3 className="confirm-title">{confirmTarget.title}</h3>

            {confirmTarget.kind === 'photo' ? (
              <img className="confirm-preview-img" src={confirmTarget.preview} alt="待删除照片" />
            ) : (
              <p className="confirm-preview-text">{confirmTarget.preview}</p>
            )}
            <p className="confirm-meta">{confirmTarget.meta}</p>
            <p className="confirm-tip">删除后将对所有人生效，且无法恢复。</p>

            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={closeConfirm} autoFocus>
                取消
              </button>
              <button className="confirm-btn danger" onClick={executeDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
