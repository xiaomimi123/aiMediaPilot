FROM node:20-alpine AS base

# 安装依赖
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# 构建
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Worker 镜像 (阶段 5.1)
#
# 单开一个 stage 而不是复用 runner: runner 装的是 Next 的 standalone 产物, 里面
# 没有 src/ 也没有 tsx, 跑不了 worker。compose 里原来写的 `node dist/jobs/worker.js`
# 指向一个从来不存在的文件 —— 这个 service 从建起来那天就没启动成功过, 而它不启动
# 时任务只会静静入队, 界面上毫无提示。
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
# deps 阶段的 npm ci 装了 devDependencies, tsx 在里面
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
RUN npx prisma generate
CMD ["npx", "tsx", "src/jobs/workers/index.ts"]

# 生产镜像
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
