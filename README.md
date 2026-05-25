# MediaPilot — 自媒体智能管理平台

Phase 1 (基础框架) 已落地:Next.js 14 + Prisma + Postgres + Tailwind,自带最小可用 OpenAI Key 配置页面。

完整产品规划见 `自媒体智能管理平台-开发文档.md`。

## 本地启动

### 1. 启动数据库 (Postgres + Redis)

```bash
cp .env.example .env
# 生成加密密钥并填入 ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up -d postgres redis
```

> Redis 是 Phase 2 才会用到的依赖,这里一起起来无妨。
> CloakBrowser 容器在 Phase 2 才启用,通过 `docker compose --profile crawler up -d` 启动。

### 2. 安装依赖 + 同步 Schema

```bash
npm install
npx prisma db push
```

### 3. 启动开发服务器

```bash
npm run dev
# http://localhost:3000  → 自动跳转 /dashboard
```

## Phase 1 验收清单

- [x] `npm install` 通过
- [x] `docker compose up -d postgres redis` 起来后 `npx prisma db push` 成功在 Postgres 建出全部表 (User / AIConfig / PlatformAccount / Content / PublishTask 等 13 张)
- [x] `npm run dev` 后 `/` 跳转 `/dashboard`
- [x] 左侧栏有 7 个导航 (总览 / 账号 / 创作 / 内容 / 竞品 / 日历 / 设置),其中 6 个是占位页 (标注后续 Phase)
- [x] `/settings` 可添加 OpenAI Key → 列表显示掩码 → 点 "测试" 真实调用 OpenAI API 验证连通 → 可删除

## 目录速览

```
src/
├── app/              # Next.js App Router
│   ├── api/v1/ai/config/  # AI 配置 CRUD + 连通性测试
│   └── settings/          # 设置页 (Phase 1 唯一功能页)
├── components/       # ui/ (shadcn 风格) + layout/ (侧边栏/顶栏)
├── lib/              # prisma 客户端 / 加密 / 默认用户 / API 包装
└── 其他子目录 (ai/ crawler/ jobs/ store/ types/) 留给后续 Phase
prisma/schema.prisma  # 13 个表完整定义,直接来自开发文档 §3.1
docker-compose.yml    # postgres + redis 默认启动;cloakbrowser 走 --profile crawler
```

## 下一步 (Phase 2)

- CloakBrowser 集成 + 浏览器 Profile 管理
- 小红书 / 抖音 账号绑定与采集
- Bull 任务队列

参见开发文档 §10 Phase 2 / §5 浏览器采集引擎 / §12.7 账号绑定。
