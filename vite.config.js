import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 开发环境：把 socket.io 请求（含 WebSocket）代理到实时后端
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      // 背景轮播照片清单与静态图片
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/photos': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
