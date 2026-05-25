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

## Phase 2 — Plan 1 (小红书端到端)

新增依赖:Chromium 容器 (本地构建,首次 2-3 分钟) + 全套 Bull/Playwright。

### 启动顺序

```bash
# 起 chromium 容器(首次会构建)
docker compose up -d chromium

# 起 worker(新终端)
npm run worker:dev

# 起 dev server(再开一个终端)
npm run dev
```

> **注意**: 如果 3000 端口被占用,Next.js 会自动跳到 3001。检查 dev server 输出确认端口。

### Plan 1 验收清单

- [ ] `docker compose up -d chromium` 后 `curl http://localhost:9222/json/version` 返回 Chrome 版本 JSON
- [ ] `http://localhost:6080/vnc.html?autoconnect=1` 能看到容器内 Chromium 桌面
- [ ] 打开 `/accounts/bind` Step 1 平台选择 + Step 2 代理表单 + 测试按钮
- [ ] 选小红书 → 跳过代理 → 看到 noVNC iframe 加载登录页
- [ ] 用真账号扫码登录 → 自动跳 Step 4 显示主页指标
- [ ] `/accounts` 卡片显示该账号 + 4 个指标 + ✓ 状态
- [ ] DB 验证: `SELECT nickname, "followerCount" FROM "PlatformAccount";` 有记录,`SELECT COUNT(*) FROM "PlatformNote";` ≥ 1

### 已知限制 (Plan 2 处理)

- 单一 Chromium profile,只能绑 1 个账号(切账号会覆盖)
- 没有定时同步,绑定时抓一次后不再更新
- 没有抖音
- VNC 通过 localhost:6080 直连,SaaS 部署需反代
- selectors v1,首次真账号验收需调整 (`src/crawler/xiaohongshu/selectors.ts`)
- Worker connectOverCDP 可能因容器报回内部 IP 而失败 — 首次跑发现需要加 wrapper 重写 webSocketDebuggerUrl 的 host 字段
