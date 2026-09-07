// ============================================================
//  扬亨的秋千宇宙 —— 实时后端服务
//  Express + Socket.IO
//  - 留言 / 照片实时广播同步
//  - 用户身份 = uid + secret（客户端生成，服务端注册校验）
//  - 删除权限由服务端判定：只能删除自己发布的内容
//  - 数据持久化到 server/data.json
// ============================================================
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, 'data.json')
const DIST_DIR = join(__dirname, '..', 'dist')
const PHOTOS_DIR = join(__dirname, '..', 'photos')
const PORT = process.env.PORT || 3001

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'])

const MAX_CONTENT = 500 // 留言最大字数
const MAX_NAME = 30
const MAX_PHOTO_LEN = 1_800_000 // 照片 dataUrl 长度上限（约 1.3MB 二进制）

// ---------- 数据持久化 ----------
function loadData() {
  try {
    if (existsSync(DATA_FILE)) {
      const d = JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
      return {
        users: d.users && typeof d.users === 'object' ? d.users : {},
        messages: Array.isArray(d.messages) ? d.messages : [],
        photos: Array.isArray(d.photos) ? d.photos : [],
      }
    }
  } catch (e) {
    console.error('⚠️ 数据文件读取失败，将使用空数据：', e.message)
  }
  return { users: {}, messages: [], photos: [] }
}

let db = loadData()
let saveTimer = null
function saveData() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true })
      writeFileSync(DATA_FILE, JSON.stringify(db))
    } catch (e) {
      console.error('⚠️ 数据保存失败：', e.message)
    }
  }, 200)
}

// ---------- 工具 ----------
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function verifyIdentity(uid, secret) {
  if (!uid || !secret) return false
  const u = db.users[uid]
  return !!u && u.secret === secret
}

function cleanStr(v, max) {
  return String(v ?? '').trim().slice(0, max)
}

// ---------- HTTP 服务 ----------
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 4_000_000, // 单条 socket 消息上限（照片 base64）
})

// ---------- 背景轮播照片（项目根目录 photos/ 文件夹） ----------
app.get('/api/photos', (req, res) => {
  let files = []
  try {
    files = readdirSync(PHOTOS_DIR)
      .filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()))
      .sort()
  } catch {
    files = []
  }
  res.json({ photos: files })
})
if (existsSync(PHOTOS_DIR)) {
  app.use('/photos', express.static(PHOTOS_DIR, { maxAge: '1h' }))
}

// 生产环境：托管打包后的前端（同域访问，无需关心 IP/端口变化）
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA 回退（非 API / socket.io 的任意路径都返回 index.html）
  app.use((req, res) => {
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/api/') || req.path.startsWith('/photos/')) return
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
}

// ---------- 实时逻辑 ----------
// 在线人数展示：小羊与独角兽两位常驻主人（基数 2），每进入一位真实访客在 2 的基础上 +1
function displayOnline() {
  return 2 + io.engine.clientsCount
}

io.on('connection', (socket) => {
  // 下发全量数据 + 在线人数
  socket.emit('init', {
    messages: db.messages,
    photos: db.photos,
    online: displayOnline(),
  })
  io.emit('presence', { online: displayOnline() })

  // 身份注册 / 校验
  socket.on('identify', (payload = {}, cb) => {
    const { uid, secret } = payload || {}
    if (!uid || !secret) return cb && cb({ ok: false })
    if (!db.users[uid]) {
      db.users[uid] = { secret, createdAt: Date.now() }
      saveData()
      cb && cb({ ok: true, uid })
    } else if (db.users[uid].secret === secret) {
      cb && cb({ ok: true, uid })
    } else {
      cb && cb({ ok: false }) // uid 撞车且密钥不符，客户端需重新生成身份
    }
  })

  // 发表留言
  socket.on('message:create', (payload = {}) => {
    const { uid, secret, name, content } = payload || {}
    if (!verifyIdentity(uid, secret)) return
    const text = String(content ?? '').trim()
    if (!text || text.length > MAX_CONTENT) return // 空内容或超长直接拒绝
    const msg = {
      id: genId(),
      uid,
      name: cleanStr(name, MAX_NAME) || '匿名',
      content: text.slice(0, MAX_CONTENT),
      timestamp: Date.now(),
    }
    db.messages.push(msg)
    saveData()
    io.emit('message:new', msg)
  })

  // 删除留言 —— 服务端鉴权：只能删自己的
  socket.on('message:delete', (payload = {}) => {
    const { uid, secret, id } = payload || {}
    if (!verifyIdentity(uid, secret)) return
    const target = db.messages.find(m => m.id === id)
    if (!target || target.uid !== uid) return // 非本人内容直接忽略
    db.messages = db.messages.filter(m => m.id !== id)
    saveData()
    io.emit('message:deleted', { id })
  })

  // 上传照片
  socket.on('photo:create', (payload = {}) => {
    const { uid, secret, authorId, dataUrl } = payload || {}
    if (!verifyIdentity(uid, secret)) return
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return
    if (dataUrl.length > MAX_PHOTO_LEN) {
      socket.emit('photo:error', { message: '图片太大啦，请换一张小一点的照片～' })
      return
    }
    const photo = {
      id: genId(),
      uid,
      authorId: cleanStr(authorId, MAX_NAME) || '匿名',
      dataUrl,
      timestamp: Date.now(),
    }
    db.photos.push(photo)
    saveData()
    io.emit('photo:new', photo)
  })

  // 删除照片 —— 服务端鉴权：只能删自己的
  socket.on('photo:delete', (payload = {}) => {
    const { uid, secret, id } = payload || {}
    if (!verifyIdentity(uid, secret)) return
    const target = db.photos.find(p => p.id === id)
    if (!target || target.uid !== uid) return
    db.photos = db.photos.filter(p => p.id !== id)
    saveData()
    io.emit('photo:deleted', { id })
  })

  socket.on('disconnect', () => {
    io.emit('presence', { online: displayOnline() })
  })
})

httpServer.listen(PORT, () => {
  console.log(`🦄 扬亨的秋千宇宙 · 实时服务已启动： http://localhost:${PORT}`)
  console.log(`   数据文件：${DATA_FILE}`)
})
