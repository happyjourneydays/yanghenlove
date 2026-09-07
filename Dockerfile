# ---------- 构建阶段：安装依赖并打包前端 ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---------- 运行阶段：仅保留生产依赖与构建产物 ----------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY photos ./photos
EXPOSE 3001
CMD ["node", "server/index.js"]
