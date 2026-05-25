# Phase 2 — 账号绑定与采集 Design

**Project**: MediaPilot (自媒体智能管理平台)
**Phase**: 2 of 6
**Date**: 2026-05-25
**Spec status**: Approved (§1–§4) — pending implementation plan
**Phase 1 status**: 已上线,框架 + Postgres + /settings (OpenAI Key) 可用

---

## 1. 目标与范围

让用户把自己的**小红书 / 抖音**账号绑进 MediaPilot,并自动把主页指标 + 最近 20 篇笔记 metadata 拉到本地数据库,为 Phase 3 Dashboard 提供数据。

### 1.1 必须达成 (verifiable)

1. 用户能从 `/accounts` 点 "+ 绑定账号" 进入 4 步向导,扫码登录后账号入库。
2. 每个账号支持 1 个独立 SOCKS5 / HTTP(S) 代理,可选,带"测试连通"按钮显示真实出口 IP。
3. 绑定完成后立即采集主页 + 前 20 篇笔记 metadata 并入库 (`PlatformAccount` / `AccountMetric` / `PlatformNote`)。
4. 账号列表页 (卡片网格) 显示每个账号的核心指标、登录状态、上次同步时间、快捷操作 (同步/重登/删除)。
5. 手动点"同步"能触发一次完整采集;每天 03:00 自动跑一次 (cron 可在 UI 关闭)。
6. cookie 失效时账号卡片显示红色 ⚠️,点击重登走与初次相同的 noVNC 流程,storageState 覆盖更新。

### 1.2 明确不在本 Phase

- 笔记**详情正文 / 评论 / 互动用户列表**采集 → Phase 2.5 或 Phase 3 lazy load
- 竞品账号采集 (`Competitor`) → Phase 6
- Dashboard 图表 → Phase 3
- 矩阵账号管理 / 批量操作 → 后续扩展 (UI 已留切表格视图的位置)
- SaaS 多租户隔离 → 见 §10,本 Phase 仅留接口,不实现

### 1.3 默认值 (摊在桌面避免歧义)

| 项 | 取值 | 理由 |
|---|---|---|
| 平台 | 小红书 + 抖音 同时 | 抽象层一次设计好,两端并行 |
| 采集深度 | 主页指标 + 笔记列表前 20 篇 metadata | Dashboard MVP 够用,详情留后 |
| 同步触发 | 手动按钮 + 每日 03:00 cron | Bull repeat job,UI 可关 |
| 登录态检查 | 每次同步前先 ping `/me`,失败标红 | 触发 UI 上的"重新登录" |
| 代理 | 每账号 1:1,可选,默认直连 | 单用户够用;SaaS 后续可演化为代理池 |

---

## 2. 架构

```
  [Next.js App]               [Postgres]
       │                         ▲
       │ ┌─ /api/v1/accounts ────┘
       │ │
       │ └─ /api/v1/sync          [Redis]
       ▼                            ▲
  [Bull Producer] ── enqueue ───────┘
                                    │
                          [Bull Worker (Node)]
                                    │
                                    │ CDP (port 9222) via internal network
                                    ▼
                          ┌─────────────────────────┐
                          │ chromium-novnc 容器      │
                          │  - Chromium (patched     │
                          │    by rebrowser-patches) │
                          │  - Xvfb + x11vnc         │
                          │  - noVNC (port 6080)     │
                          │  - websockify            │
                          │  - /profiles/<accountId> │
                          │      (userDataDir)       │
                          └─────────────────────────┘
                                    ▲
                                    │ iframe (反代后的 VNC path)
                                    │
                              [浏览器: /accounts/bind]
```

### 2.1 关键架构决策

- **采集 worker 跑在 Node 进程**,通过 Bull 排队;CDP 远程连容器内 Chromium。
  开发期 worker 与 Next.js 同进程;生产期独立成 `worker` 容器 (Phase 1 docker-compose 已留)。
- **Chromium 只跑在容器里**,主机不安装 Playwright 浏览器,保证反检测补丁一致性。
- **Reverse proxy noVNC**: Next.js API 路由 `/api/v1/sessions/[id]/vnc` 转发 websocket 到容器 6080,**不直接把 6080 暴露到主机**。SaaS 时复用该层做权限控制。
- **每账号一个 `userDataDir`**,挂载到容器内 `/profiles/<accountId>`,登录态自然持久化,无需手动 `storageState.json` 来回拷贝。
- **rebrowser-patches** 在容器构建时应用到 npm `playwright` 包(`npx rebrowser-patches@latest patch --packagePath /app/node_modules/playwright-core` 等价命令)。

### 2.2 反检测策略

1. `rebrowser-patches` 抹除 CDP 标识 (`Runtime.Enable` 检测点)
2. 启动参数:`--disable-blink-features=AutomationControlled`,不加 `--headless`,Xvfb 模拟真实显示
3. UA / viewport / 时区 / 语言通过 Playwright 注入,与代理出口 IP 地理位置一致 (注:出口 IP geo 探测见 §3 测试代理)
4. `playwright-extra` 不引入,避免与 rebrowser-patches 冲突

---

## 3. 数据模型增量

(基于 Phase 1 schema.prisma)

```prisma
model PlatformAccount {
  // ... 原有字段 ...
  proxy        Json?        // {type, host, port, username?, password?},应用层 AES-256-GCM 加密
  syncCron     String?      // "0 3 * * *",null 表示禁用自动同步
  loginStatus  LoginStatus  @default(VALID)
  // cookieData (Phase 1 已有):MVP 不写入,登录态完全靠 /profiles/<accountId>/ userDataDir 持有;
  //   SaaS 阶段会改用它做跨节点持久化备份。保留字段 nullable,免迁移。
}

enum LoginStatus {
  VALID
  EXPIRED        // ping /me 检测失败
  NEVER_LOGGED   // 创建后尚未完成登录
}

// 浏览器会话(短生命周期,登录用)
model BrowserSession {
  id          String         @id @default(cuid())
  userId      String
  platform    Platform
  accountId   String?        // 登录成功后回填(初次绑定时还未创建)
  status      SessionStatus  @default(STARTING)
  cdpUrl      String         // worker 用,如 http://chromium:9222
  vncPath     String         // 前端 iframe 用,如 /api/v1/sessions/abc123/vnc
  containerId String?        // docker exec 标识,SaaS 时按 user 隔离
  proxyTest   Json?          // {exitIp, geo, latency, ok},供 UI 显示
  expiresAt   DateTime       // 默认 +8min,过期 worker 自动清理
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  @@index([userId, status])
  @@index([status, expiresAt])
}

enum SessionStatus {
  STARTING
  WAITING_LOGIN
  LOGGED_IN
  SCRAPING       // 登录成功后转采集状态
  EXPIRED
  ERROR
}
```

`SyncTask`(Phase 1 已有)直接复用,`type` 字段值 `PROFILE` / `NOTES`。

---

## 4. 关键流程

### 4.1 绑定账号 (Wizard)

```
用户点 [+ 绑定账号]
  │
  ▼
Step 1  选平台 (小红书 / 抖音)
  │
  ▼
Step 2  配代理 (直连 / SOCKS5 / HTTP,可选)
  │     [↻ 测试连通] → 后端真发请求查 IP,UI 显示出口 IP + 地理位置
  │
  ▼  POST /api/v1/accounts/bind-session  { platform, proxy? }
  │     后端: 创建 BrowserSession,Playwright 在容器内打开登录 URL,
  │            返回 { sessionId, vncPath, expiresAt }
  │
Step 3  前端 iframe 嵌入 noVNC
  │     后端轮询(Bull job): Playwright 监听 URL 变化或 cookie 出现
  │     status 路径: STARTING → WAITING_LOGIN → LOGGED_IN
  │     前端用 SSE (Server-Sent Events) 监听状态变化,LOGGED_IN 自动跳下一步
  │
  ▼
Step 4  后端继续用同一 context 抓主页 + 前 20 篇笔记 metadata
  │     status: LOGGED_IN → SCRAPING → (写库) → 完成
  │     绑定时 userDataDir 路径为 /profiles/<sessionId>/,
  │       完成时 mv 到 /profiles/<accountId>/ 长期持有
  │
  ▼
完成页 显示账号信息 + 跳 /accounts
```

**异常分支**:

| 场景 | 处理 |
|---|---|
| 8 分钟未登录 | session expires,worker 杀掉浏览器上下文,UI 提示重试 |
| 风控页(滑块/手机验证)出现 | 用户在 noVNC 里自己操作完成,后端无需介入 |
| 登录成功但首次采集失败 | 账号建出来,`syncStatus=FAILED`,卡片显示"重试同步" |
| 代理连不通 | Step 2 测试时拦下,不放过 |

### 4.2 日常同步 (定时 / 手动)

```
触发源:
  - cron (Bull repeat job, 03:00 daily) — 仅对 syncCron != null 的账号
  - 用户点账号卡片"同步" — 入队列单次任务

Worker 流程:
  1. 加载 proxy → decrypt → 拼 launch options
  2. CDP 连容器,新建 context,设置 userDataDir=/profiles/<accountId>/
       (登录态自动来自磁盘,无需手动 storageState)
  3. ping 平台 /me 端点
       - 失败 → 更新 loginStatus=EXPIRED,任务标失败,UI 红色 ⚠️
       - 成功 → 继续
  4. 抓主页指标 → upsert AccountMetric (date=today)
  5. 抓笔记列表前 20 → upsert PlatformNote(按 platformNoteId)
  6. 更新 PlatformAccount.lastSyncAt
  7. 关闭 context (userDataDir 持久化保留)
```

### 4.3 重登 (cookie 失效后)

复用绑定 Wizard 的 Step 3 (跳过 Step 1/2,因为已知 platform 和 proxy):

```
用户点账号卡片 [重登]
  │
  ▼  POST /api/v1/accounts/:id/relogin
  │     后端创建 BrowserSession (accountId 已知),复用原 userDataDir
  │     如果原 cookie 部分有效,平台可能直接进首页(免扫码)
  │
  ▼  前端弹 noVNC 模态,登录成功后关闭
  │     storageState 覆盖更新到 cookieData
  │     loginStatus=VALID
```

---

## 5. UI 设计 (经过 Visual Companion 确认)

### 5.1 /accounts — 账号列表 (卡片网格,布局 A)

- 顶部:页面标题 + 右上 [+ 绑定账号] 主按钮
- 内容:CSS Grid,移动端 1 列 / 平板 2 列 / 桌面 3 列
- 卡片元素 (从上到下):
  - 头像 + 昵称 + 平台 emoji + 同步时间
  - 4 指标条:粉丝 / 关注 / 笔记 / 获赞 (含 ↑↓ 趋势箭头)
  - 状态徽章:✓ 正常 / ⚠️ cookie 失效 / 🟡 同步中
  - 操作按钮组:[同步] [重登] [详情] [···删除]
- 空状态:中央插画 + "点击右上角绑定你的第一个账号"

### 5.2 /accounts/bind — 4 步向导

- 顶部进度条 (Step indicator):选平台 / 网络 / 登录 / 完成
- Step 1: 两张大卡 (小红书 / 抖音),单选
- Step 2:
  - tab 切换:直连 / SOCKS5 / HTTP(S)
  - 表单:host / port / username / password
  - [↻ 测试连通] 按钮 → 显示 ✓ 出口 IP: x.x.x.x (geo)
  - 底部 [跳过] [下一步]
- Step 3:
  - 主区:左 70% noVNC iframe (高度 ≥ 400px) / 右 30% 操作指引 + 倒计时 + "等待登录..." 状态
  - 后台 SSE 推送 status 变化,LOGGED_IN 时自动跳 Step 4
- Step 4:
  - 抓取结果卡片回显主页信息 + "正在采集 20 篇笔记..." 进度条
  - 底部 [完成,去看数据] 跳 /accounts

### 5.3 复用 Phase 1 风格

- 使用现有 shadcn 风格组件 (Button / Input / Label / Card / Select)
- 新增:Tabs (Step 2 代理类型切换) / Progress (Step 4 笔记采集进度) / Badge (账号卡片状态徽章)
- 配色:Phase 1 已定义的 CSS 变量 (--primary / --destructive / --muted)
- noVNC iframe 包一层 `<div class="rounded-lg border bg-card">`,视觉与其他卡片一致

---

## 6. API 接口设计

基础路径 `/api/v1`,响应格式继承 Phase 1 `{ success, data, message }`。

### 6.1 账号管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/accounts` | 列出当前用户所有账号 (含核心指标、登录状态、上次同步时间) |
| POST | `/accounts/bind-session` | 创建绑定会话,返回 `{ sessionId, vncPath, expiresAt }` |
| POST | `/accounts/:id/relogin` | 已绑定账号触发重登 |
| POST | `/accounts/:id/sync` | 手动触发一次同步 (返回 syncTaskId) |
| PATCH | `/accounts/:id` | 更新 syncCron / proxy / isActive |
| DELETE | `/accounts/:id` | 删账号 (含 userDataDir 清理) |

### 6.2 浏览器会话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions/:id` | 查会话状态 |
| GET | `/sessions/:id/events` (SSE) | 订阅 status 变化 |
| ANY | `/sessions/:id/vnc/*` | WebSocket / HTTP 反代到容器 6080 |
| POST | `/sessions/:id/cancel` | 取消会话 |

### 6.3 代理

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/proxy/test` | Body: `{type, host, port, username?, password?}`,返回 `{exitIp, geo, latencyMs, ok}` |

### 6.4 同步任务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sync/tasks?accountId=` | 同步历史 (分页) |
| GET | `/sync/tasks/:id` | 单任务详情 + 错误信息 |

---

## 7. 模块划分 & 文件结构

```
src/
├── app/
│   ├── accounts/
│   │   ├── page.tsx                  # 卡片网格列表
│   │   ├── bind/page.tsx             # 4 步向导
│   │   └── [id]/relogin/page.tsx     # 重登 (复用 BindWizard step 3)
│   └── api/v1/
│       ├── accounts/route.ts
│       ├── accounts/bind-session/route.ts
│       ├── accounts/[id]/
│       │   ├── route.ts              # PATCH / DELETE
│       │   ├── sync/route.ts
│       │   └── relogin/route.ts
│       ├── sessions/[id]/
│       │   ├── route.ts
│       │   ├── events/route.ts       # SSE
│       │   ├── cancel/route.ts
│       │   └── vnc/[...path]/route.ts  # WebSocket 反代
│       ├── proxy/test/route.ts
│       └── sync/tasks/route.ts
├── crawler/
│   ├── base.ts                       # ICrawler 接口
│   ├── browser-pool.ts               # 容器内 CDP 连接管理
│   ├── xiaohongshu/
│   │   ├── crawler.ts
│   │   ├── login-detector.ts         # 平台专属登录态判断
│   │   └── selectors.ts
│   └── douyin/
│       ├── crawler.ts
│       ├── login-detector.ts
│       └── selectors.ts
├── jobs/
│   ├── queue.ts                      # Bull 队列定义
│   ├── workers/
│   │   ├── sync-worker.ts            # 同步任务消费者
│   │   └── session-watcher.ts        # BrowserSession 状态轮询
│   └── schedulers/
│       └── daily-sync.ts             # cron repeat job
├── lib/
│   ├── redis.ts                      # ioredis 客户端 (Phase 2 新增)
│   ├── proxy.ts                      # 测试连通 + 出口 IP / geo 查询
│   └── sse.ts                        # Server-Sent Events helper
├── components/
│   ├── accounts/
│   │   ├── account-card.tsx
│   │   ├── account-grid.tsx
│   │   └── empty-state.tsx
│   ├── binding/
│   │   ├── wizard.tsx                # 4 步骨架
│   │   ├── step-platform.tsx
│   │   ├── step-proxy.tsx
│   │   ├── step-login.tsx            # 内含 noVNC iframe
│   │   └── step-complete.tsx
│   └── ui/
│       ├── tabs.tsx                  # 新增
│       ├── progress.tsx              # 新增
│       └── badge.tsx                 # 新增
└── docker/
    └── chromium-novnc/
        ├── Dockerfile                # 自建镜像 (alpine + chromium + noVNC + rebrowser-patches)
        ├── entrypoint.sh
        └── supervisord.conf
```

---

## 8. Docker 调整

`docker-compose.yml` 加新 service (替换 Phase 1 留的 cloakbrowser-manager 占位):

```yaml
chromium:
  build:
    context: ./src/docker/chromium-novnc
  container_name: mediapilot-chromium
  ports:
    - "127.0.0.1:9222:9222"   # 仅本地 CDP
    # 6080 不暴露,由 Next.js 反代
  volumes:
    - chromium-profiles:/profiles
  shm_size: 2gb               # Chromium 需要
  restart: unless-stopped
```

`worker` service 通过 `CDP_URL=http://chromium:9222` 连接;noVNC 通过 docker 内网 `http://chromium:6080` 让 Next.js 反代。

`worker` 替换 Phase 1 Dockerfile.command 为 `node dist/jobs/worker.js`,该入口已在文件结构中规划。

---

## 9. 错误处理 & 边界

| 场景 | 处理 | 状态码 |
|---|---|---|
| 代理测试连不通 | 返回错误,前端禁用"下一步" | 400 |
| chromium 容器没起 | 健康检查兜底,API 返回 503 + 维护提示 | 503 |
| 同账号同时多个同步任务 | Bull 用 `jobId=accountId-sync`,后入队的去重丢弃 | — |
| 平台改版 selector 失效 | 采集器抛 `SelectorMissing`,任务标 FAILED 但账号保留 | — |
| storageState 解密失败 (ENCRYPTION_KEY 变更) | 标 EXPIRED,UI 强制重登 | — |
| 笔记列表 < 20 (新号) | 抓多少存多少,不补全 | — |

---

## 10. SaaS 升级路径预留

为后期"部署到服务器卖给多个用户"提前留好接口,本 Phase **不实现**,但当前选择不挡路:

| 模块 | 当前 (Phase 2 MVP) | SaaS 升级时改造点 |
|---|---|---|
| 浏览器容器 | 单个 chromium 容器,顺序服务 | 容器池 + 按 user 隔离 namespace,或每 user 启临时容器 |
| userDataDir | 共享 volume `chromium-profiles` | 按 `userId/accountId` 二级目录,SaaS 时配合对象存储/EFS |
| noVNC 反代 | Next.js API 路由直接转发 | 加 session token / JWT 校验,仅允许 owner 访问 |
| BrowserSession | 单进程内存 + DB | DB 为主,worker 跨进程认领 |
| Bull 队列 | 单 worker | 多 worker 横向扩展,Bull 已支持 |
| 代理 | 用户自带 1:1 | 平台运营代理池,按账号分配 |

---

## 11. 测试策略

- **单元测试**: crawler base interface、proxy 测试逻辑、login-detector 解析
- **集成测试 (本机)**: 起 chromium 容器 + 模拟 storageState,验证 sync-worker 端到端跑通 (mock 平台返回)
- **手动验收**: 真账号在本机走完整绑定 → 同步 → 重登流程 (各 1 个 XHS + 1 个抖音)
- **CI 跳过**: 真平台 E2E 不进 CI (反爬不可预测),仅本地手动

---

## 12. 不在本 Phase 但要记录的事

- 笔记详情、评论、热度时序 → Phase 2.5 或 3
- 视频文件下载 → Phase 5 (发布模块自己处理)
- 多账号矩阵管理、批量代理 → 后续 (UI 留切换入口)
- 竞品采集 → Phase 6 (复用 base crawler,只是不需要登录态)
