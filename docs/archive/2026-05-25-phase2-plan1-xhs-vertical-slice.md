# Phase 2 Plan 1 — 小红书端到端 (Infra + Bind) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MediaPilot 从"只能配 OpenAI Key"推到"能扫码绑定一个小红书账号、首次抓取主页 + 20 篇笔记入库、卡片列表展示",作为 Phase 2 的第一个可演示里程碑。

**Architecture:** chromium-novnc Docker 容器(自建镜像,含 Xvfb + x11vnc + noVNC + websockify + Chromium)+ Node 侧 Playwright (CDP 远程连接, rebrowser-patches 反检测) + BullMQ on Redis 排队 + Next.js API 路由反代 noVNC + SSE 推送状态。每账号 1:1 代理(可选)。

**Tech Stack:** Next.js 14 App Router · TypeScript · Prisma · Playwright-core · rebrowser-patches · BullMQ · ioredis · Postgres · Tailwind · Docker Compose

**Scope** (Plan 2 不在此): 抖音 crawler、cron 定时同步、独立 sync worker、重登流程 polished UI、笔记详情。

---

## File Structure

```
新建:
src/docker/chromium-novnc/Dockerfile
src/docker/chromium-novnc/entrypoint.sh
src/docker/chromium-novnc/supervisord.conf
src/lib/redis.ts
src/lib/sse.ts
src/lib/proxy.ts
src/lib/platform.ts                          # 平台元信息 (URL / 名称),供 crawler 复用
src/crawler/base.ts                          # ICrawler 接口
src/crawler/browser-pool.ts                  # CDP 连接管理 + context 工厂
src/crawler/xiaohongshu/selectors.ts
src/crawler/xiaohongshu/login-detector.ts
src/crawler/xiaohongshu/crawler.ts
src/jobs/queue.ts                            # BullMQ 队列定义
src/jobs/workers/bind-worker.ts              # 绑定 + 首次抓取
src/jobs/workers/index.ts                    # worker 启动入口
vitest.config.ts                             # vitest path alias 配置
src/components/ui/tabs.tsx
src/components/ui/progress.tsx
src/components/ui/badge.tsx
src/components/accounts/account-card.tsx
src/components/accounts/account-grid.tsx
src/components/accounts/empty-state.tsx
src/components/binding/wizard.tsx
src/components/binding/step-platform.tsx
src/components/binding/step-proxy.tsx
src/components/binding/step-login.tsx
src/components/binding/step-complete.tsx
src/app/accounts/bind/page.tsx
src/app/api/v1/proxy/test/route.ts
src/app/api/v1/accounts/route.ts
src/app/api/v1/accounts/bind-session/route.ts
src/app/api/v1/sessions/[id]/route.ts
src/app/api/v1/sessions/[id]/events/route.ts
src/app/api/v1/sessions/[id]/cancel/route.ts
src/app/api/v1/sessions/[id]/vnc/[...path]/route.ts
tests/lib/proxy.test.ts
tests/crawler/xiaohongshu-selectors.test.ts
tests/api/proxy.test.ts

修改:
prisma/schema.prisma                          # 增 BrowserSession + 扩 PlatformAccount
package.json                                  # 加新依赖 + 测试 script
docker-compose.yml                            # 删 cloakbrowser 占位,加 chromium service
src/app/accounts/page.tsx                     # 占位 → 真实列表
.env.example                                  # 加 CDP_URL / CHROMIUM_VNC_URL
README.md                                     # 验收清单更新
```

---

## Test Strategy

- **可单元测的**: `lib/proxy` (parse + test 调用)、`lib/sse` (流格式)、`crawler/base` (接口契约)、API 路由 (request shape)
- **集成测**: bind 流程 mock 一个 fake 小红书页面(本地 HTML),验证 login-detector 正确识别
- **手动 E2E**: Task 18 列出真账号验收清单(单平台,本机)
- **CI 不跑**: 容器 + 真平台

测试框架: **vitest** (轻量,与 Next 14 兼容好)

---

## Git

Plan 1 第一个任务里 `git init`,之后每个 task 末尾 `git commit`。如果你不想要 git,跑到 Task 1 时跳过该步骤即可。

---

## Task 1: 初始化 git + 安装 Phase 2 依赖

**Files:**
- Modify: `package.json`
- Create: `.gitignore` (Phase 1 已存在,确认而已)

- [ ] **Step 1.1: 初始化 git 仓库 + 首次提交 Phase 1 状态**

```bash
cd /Users/lizhishaoniange/Documents/ai自媒体智能体
git init
git add .
git commit -m "chore: initial commit (Phase 1 baseline)"
```

如果你不想用 git,跳过此 step,后续每个 task 的 commit 步骤也一并跳过。

- [ ] **Step 1.2: 添加 Phase 2 运行时依赖**

修改 `package.json` 的 `dependencies` 加入:

```json
"playwright-core": "^1.49.0",
"bullmq": "^5.34.0",
"ioredis": "^5.4.1"
```

`devDependencies` 加入:

```json
"@types/ws": "^8.5.13",
"rebrowser-patches": "^1.0.10",
"vitest": "^2.1.8",
"@vitest/ui": "^2.1.8"
```

scripts 部分增加:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 1.3: 安装 + 应用 rebrowser-patches**

```bash
npm install
npx rebrowser-patches@latest patch --packagePath node_modules/playwright-core
```

预期看到 `Patched 5/5` 之类成功输出。

⚠️ patch 是 npm install 后必须重跑的,在 `package.json` 加 `postinstall`:

```json
"postinstall": "prisma generate && rebrowser-patches patch --packagePath node_modules/playwright-core || true"
```

(`|| true` 是为了让 fresh clone 时 patch 失败不中断 install — 因为patch 已经打过会报错)

- [ ] **Step 1.4: 验证 playwright-core 能引入**

```bash
node -e "const { chromium } = require('playwright-core'); console.log(chromium ? 'OK' : 'FAIL')"
```

预期: `OK`

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(phase2): add playwright-core, bullmq, ioredis, vitest"
```

---

## Task 2: 扩展 Prisma schema + 推到数据库

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 2.1: 在 PlatformAccount 模型加 3 个字段**

在 `prisma/schema.prisma` 的 `PlatformAccount` 模型最后(`@@unique` 之前)插入:

```prisma
  proxy        Json?
  syncCron     String?
  loginStatus  LoginStatus  @default(VALID)
```

- [ ] **Step 2.2: 在 PlatformAccount 上方加 LoginStatus enum**

在 `enum Platform { ... }` 后插入:

```prisma
enum LoginStatus {
  VALID
  EXPIRED
  NEVER_LOGGED
}
```

- [ ] **Step 2.3: 在文件末尾追加 BrowserSession + SessionStatus**

```prisma
// ==================== 浏览器会话(短生命周期,登录用) ====================

model BrowserSession {
  id          String        @id @default(cuid())
  userId      String
  platform    Platform
  accountId   String?
  status      SessionStatus @default(STARTING)
  cdpUrl      String
  vncPath     String
  containerId String?
  proxyTest   Json?
  expiresAt   DateTime
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([userId, status])
  @@index([status, expiresAt])
}

enum SessionStatus {
  STARTING
  WAITING_LOGIN
  LOGGED_IN
  SCRAPING
  EXPIRED
  ERROR
}
```

- [ ] **Step 2.4: 推到数据库**

```bash
npx prisma db push
```

预期: `🚀 Your database is now in sync with your Prisma schema.`

- [ ] **Step 2.5: 验证 BrowserSession 表已建**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "BrowserSession"'
```

预期看到 10 列字段、id 主键、2 个 index。

- [ ] **Step 2.6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(phase2): extend schema — BrowserSession + PlatformAccount proxy/syncCron/loginStatus"
```

---

## Task 3: chromium-novnc Docker 镜像

**Files:**
- Create: `src/docker/chromium-novnc/Dockerfile`
- Create: `src/docker/chromium-novnc/entrypoint.sh`
- Create: `src/docker/chromium-novnc/supervisord.conf`
- Modify: `docker-compose.yml`

- [ ] **Step 3.1: Dockerfile**

写 `src/docker/chromium-novnc/Dockerfile`:

```dockerfile
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    SCREEN_DEPTH=24

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb \
      x11vnc \
      supervisor \
      novnc \
      websockify \
      ca-certificates \
      fonts-noto-cjk \
      dumb-init \
      curl \
    && rm -rf /var/lib/apt/lists/*

# noVNC vnc.html → 浏览器入口
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
RUN mkdir -p /profiles

COPY entrypoint.sh /entrypoint.sh
COPY supervisord.conf /etc/supervisor/conf.d/chromium.conf
RUN chmod +x /entrypoint.sh

EXPOSE 9222 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]
```

- [ ] **Step 3.2: entrypoint.sh**

写 `src/docker/chromium-novnc/entrypoint.sh`:

```bash
#!/bin/bash
set -e
mkdir -p /profiles
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
```

- [ ] **Step 3.3: supervisord.conf**

写 `src/docker/chromium-novnc/supervisord.conf`:

```ini
[supervisord]
nodaemon=true
user=root

[program:xvfb]
command=/usr/bin/Xvfb :99 -screen 0 %(ENV_SCREEN_WIDTH)sx%(ENV_SCREEN_HEIGHT)sx%(ENV_SCREEN_DEPTH)s
autorestart=true
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:chromium]
command=/usr/bin/chromium
    --remote-debugging-address=0.0.0.0
    --remote-debugging-port=9222
    --no-sandbox
    --disable-gpu
    --disable-dev-shm-usage
    --disable-blink-features=AutomationControlled
    --window-size=%(ENV_SCREEN_WIDTH)s,%(ENV_SCREEN_HEIGHT)s
    --user-data-dir=/profiles/default
environment=DISPLAY=":99"
autorestart=true
priority=20
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:x11vnc]
command=/usr/bin/x11vnc -display :99 -nopw -forever -shared -rfbport 5900 -quiet
autorestart=true
priority=30
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:novnc]
command=/usr/bin/websockify --web=/usr/share/novnc 6080 localhost:5900
autorestart=true
priority=40
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

- [ ] **Step 3.4: docker-compose.yml 加 chromium service**

修改 `docker-compose.yml`:

删掉整个 `cloakbrowser-manager:` 块。

在 `redis:` 块之后插入:

```yaml
  chromium:
    build:
      context: ./src/docker/chromium-novnc
    container_name: mediapilot-chromium
    ports:
      - "127.0.0.1:9222:9222"
      - "127.0.0.1:6080:6080"
    volumes:
      - chromium-profiles:/profiles
    shm_size: "2gb"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9222/json/version"]
      interval: 5s
      timeout: 5s
      retries: 10
```

把顶层 `volumes:` 块里的 `cloak-profiles:` 改成 `chromium-profiles:`。

(临时把 6080 暴露到 localhost,Task 12 反代上线后再删)

- [ ] **Step 3.5: 构建 + 启动**

```bash
docker compose build chromium
docker compose up -d chromium
```

构建首次约 2-3 分钟。

- [ ] **Step 3.6: 验证 CDP 可达**

```bash
sleep 8
curl -s http://localhost:9222/json/version | head -50
```

预期: 返回 JSON,含 `"Browser": "Chrome/..."` 字段。

- [ ] **Step 3.7: 验证 noVNC 可访问**

浏览器打开 `http://localhost:6080/vnc.html?autoconnect=1&resize=scale`,应看到 Chromium 启动画面或 `about:blank`。

- [ ] **Step 3.8: Commit**

```bash
git add src/docker docker-compose.yml
git commit -m "feat(phase2): self-built chromium-novnc image (xvfb + x11vnc + novnc + supervisor)"
```

---

## Task 4: Redis 客户端 + BullMQ 队列骨架

**Files:**
- Create: `src/lib/redis.ts`
- Create: `src/jobs/queue.ts`
- Modify: `.env.example`

- [ ] **Step 4.1: lib/redis.ts**

```typescript
import IORedis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export const redis =
  globalForRedis.redis ??
  new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
```

`maxRetriesPerRequest: null` 是 BullMQ 必需的设置。

- [ ] **Step 4.2: jobs/queue.ts**

```typescript
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  BIND: 'bind-session',
  SYNC: 'sync',
} as const;

export const bindQueue = new Queue(QUEUES.BIND, { connection: redis });
export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
```

- [ ] **Step 4.3: 加 CDP_URL 到 .env.example 和 .env**

在 `.env.example` 和 `.env` 末尾追加:

```
# Chromium CDP (Phase 2)
CDP_URL=http://localhost:9222
CHROMIUM_VNC_URL=http://localhost:6080
```

- [ ] **Step 4.4: 类型检查 + 命令行验证 Redis 连通**

```bash
npm run typecheck
node -e "const IORedis = require('ioredis'); const r = new IORedis(); r.ping().then(p => { console.log(p); r.disconnect(); })"
```

预期:`PONG`

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/redis.ts src/jobs/queue.ts .env.example .env
git commit -m "feat(phase2): redis client + bullmq queue skeleton"
```

---

## Task 5: lib/proxy.ts — 代理测试逻辑

**Files:**
- Create: `src/lib/proxy.ts`
- Create: `tests/lib/proxy.test.ts`

- [ ] **Step 5.1: 写 proxy 类型 + 测试连通函数**

`src/lib/proxy.ts`:

```typescript
export type ProxyConfig = {
  type: 'socks5' | 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type ProxyTestResult = {
  ok: boolean;
  exitIp?: string;
  geo?: string;
  latencyMs?: number;
  error?: string;
};

// 把 ProxyConfig 转成 Playwright 的 launch proxy 选项
export function toPlaywrightProxy(p: ProxyConfig) {
  const scheme = p.type === 'socks5' ? 'socks5' : p.type;
  return {
    server: `${scheme}://${p.host}:${p.port}`,
    username: p.username,
    password: p.password,
  };
}

// 测试连通:用 Playwright launch + 访问 ip.sb / httpbin,拿出口 IP
// 在 Task 7 (browser pool) 后才能完整跑;这里先实现纯参数版本,Task 7 接入
export function validateProxyShape(p: Partial<ProxyConfig>): string | null {
  if (!p.type) return 'type required';
  if (!['socks5', 'http', 'https'].includes(p.type)) return 'invalid type';
  if (!p.host || typeof p.host !== 'string') return 'host required';
  if (!p.port || typeof p.port !== 'number' || p.port < 1 || p.port > 65535)
    return 'port out of range';
  if (p.username !== undefined && typeof p.username !== 'string')
    return 'username must be string';
  if (p.password !== undefined && typeof p.password !== 'string')
    return 'password must be string';
  return null;
}
```

- [ ] **Step 5.2: 写测试**

`tests/lib/proxy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { toPlaywrightProxy, validateProxyShape } from '@/lib/proxy';

describe('toPlaywrightProxy', () => {
  it('socks5 with auth', () => {
    expect(
      toPlaywrightProxy({ type: 'socks5', host: 'p.com', port: 1080, username: 'u', password: 'p' })
    ).toEqual({ server: 'socks5://p.com:1080', username: 'u', password: 'p' });
  });

  it('http without auth', () => {
    expect(toPlaywrightProxy({ type: 'http', host: 'p.com', port: 8080 })).toEqual({
      server: 'http://p.com:8080',
      username: undefined,
      password: undefined,
    });
  });
});

describe('validateProxyShape', () => {
  it('valid socks5', () => {
    expect(validateProxyShape({ type: 'socks5', host: 'p.com', port: 1080 })).toBeNull();
  });

  it('missing host', () => {
    expect(validateProxyShape({ type: 'socks5', port: 1080 } as any)).toMatch(/host/);
  });

  it('port out of range', () => {
    expect(validateProxyShape({ type: 'http', host: 'p.com', port: 99999 })).toMatch(/port/);
  });

  it('invalid type', () => {
    expect(validateProxyShape({ type: 'ftp' as any, host: 'p.com', port: 80 })).toMatch(/type/);
  });
});
```

- [ ] **Step 5.3: 加 vitest 配置 (vitest.config.ts) — 仅 path alias**

`vitest.config.ts` (项目根):

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 5.4: 跑测试**

```bash
npm test
```

预期:7 个 test 全过。

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/proxy.ts tests/lib/proxy.test.ts vitest.config.ts
git commit -m "feat(phase2): proxy config types + validation"
```

---

## Task 6: POST /api/v1/proxy/test — 真实测试代理连通

**Files:**
- Create: `src/app/api/v1/proxy/test/route.ts`
- Create: `tests/api/proxy.test.ts`

- [ ] **Step 6.1: API 路由**

`src/app/api/v1/proxy/test/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { chromium } from 'playwright-core';
import { ok, fail } from '@/lib/api';
import { toPlaywrightProxy, validateProxyShape, type ProxyConfig } from '@/lib/proxy';

const CDP_URL = process.env.CDP_URL || 'http://localhost:9222';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<ProxyConfig> | null;
  if (!body) return fail('请求体不合法');
  const err = validateProxyShape(body);
  if (err) return fail(err);

  const proxyConfig = body as ProxyConfig;
  const started = Date.now();
  let browser;
  try {
    // 走容器内 Chromium,通过 CDP 连接
    browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = await browser.newContext({ proxy: toPlaywrightProxy(proxyConfig) });
    const page = await ctx.newPage();
    // ip.sb 国内可达且返回 JSON,api.ipify.org 也行;失败则换 httpbin
    await page.goto('https://api.ipify.org?format=json', { timeout: 15_000 });
    const text = await page.locator('body').innerText();
    await ctx.close();
    const parsed = JSON.parse(text);
    return ok({
      ok: true,
      exitIp: parsed.ip as string,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    return fail(`代理连接失败: ${e instanceof Error ? e.message : String(e)}`, 400);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
```

- [ ] **Step 6.2: 集成测 (mock playwright)**

`tests/api/proxy.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/proxy/test/route';

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: vi.fn(async () => ({
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => ({
          goto: vi.fn(),
          locator: () => ({ innerText: vi.fn(async () => '{"ip":"1.2.3.4"}') }),
        })),
        close: vi.fn(),
      })),
      close: vi.fn(),
    })),
  },
}));

describe('POST /api/v1/proxy/test', () => {
  it('validation rejects missing host', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ type: 'socks5', port: 1080 }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('happy path returns exit ip', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ type: 'socks5', host: 'p.com', port: 1080 }),
    });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.exitIp).toBe('1.2.3.4');
  });
});
```

- [ ] **Step 6.3: 跑测试 + typecheck**

```bash
npm test && npm run typecheck
```

- [ ] **Step 6.4: 手动验证 (容器需运行 + 直连)**

直连(空 proxy 不能直接传给 Playwright,所以这条手动跳过,要靠真代理测)。
如果你有 SOCKS5 代理,可以:

```bash
curl -X POST http://localhost:3000/api/v1/proxy/test \
  -H 'content-type: application/json' \
  -d '{"type":"socks5","host":"YOUR_PROXY_HOST","port":1080}'
```

- [ ] **Step 6.5: Commit**

```bash
git add src/app/api/v1/proxy/test tests/api/proxy.test.ts
git commit -m "feat(phase2): POST /api/v1/proxy/test — verifies SOCKS5/HTTP proxy via CDP"
```

---

## Task 7: Crawler base interface + browser pool

**Files:**
- Create: `src/crawler/base.ts`
- Create: `src/crawler/browser-pool.ts`
- Create: `src/lib/platform.ts`

- [ ] **Step 7.1: lib/platform.ts (平台元信息)**

```typescript
import type { Platform } from '@prisma/client';

export const PLATFORM_META: Record<Platform, {
  label: string;
  loginUrl: string;
  homeUrl: string;
}> = {
  XIAOHONGSHU: {
    label: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/login',
    homeUrl: 'https://www.xiaohongshu.com',
  },
  DOUYIN: {
    label: '抖音',
    loginUrl: 'https://www.douyin.com',
    homeUrl: 'https://www.douyin.com',
  },
  WECHAT_MP: { label: '微信公众号', loginUrl: '', homeUrl: '' },
  BILIBILI:   { label: 'B 站',     loginUrl: '', homeUrl: '' },
  KUAISHOU:   { label: '快手',     loginUrl: '', homeUrl: '' },
  WEIBO:      { label: '微博',     loginUrl: '', homeUrl: '' },
};
```

- [ ] **Step 7.2: crawler/base.ts (接口)**

```typescript
import type { BrowserContext, Page } from 'playwright-core';

export interface ProfileSnapshot {
  platformUid: string;
  nickname: string;
  avatar?: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
  noteCount: number;
  likeCount: number;
}

export interface NoteSummary {
  platformNoteId: string;
  title: string;
  type: 'IMAGE_TEXT' | 'VIDEO' | 'LIVE';
  coverUrl?: string;
  tags: string[];
  publishedAt?: Date;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
  collectCount: number;
  sourceUrl?: string;
}

export interface ICrawler {
  /** 判断当前页是否已登录 */
  isLoggedIn(page: Page): Promise<boolean>;
  /** 已登录 context 上抓主页 */
  scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot>;
  /** 已登录 context 上抓笔记列表 */
  scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]>;
}
```

- [ ] **Step 7.3: crawler/browser-pool.ts (CDP 连接管理)**

```typescript
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { ProxyConfig } from '@/lib/proxy';
import { toPlaywrightProxy } from '@/lib/proxy';

const CDP_URL = process.env.CDP_URL || 'http://localhost:9222';

let _shared: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_shared && _shared.isConnected()) return _shared;
  _shared = await chromium.connectOverCDP(CDP_URL);
  _shared.on('disconnected', () => (_shared = null));
  return _shared;
}

export interface ContextOpts {
  /** 容器内 userDataDir 路径,如 /profiles/<sessionId> */
  userDataDir?: string;  // CDP 模式下其实是新建 context 而不是 launch persistent;真要持久化需用 launchPersistentContext。 详见 Step 7.4 备注。
  proxy?: ProxyConfig | null;
}

export async function openContext(opts: ContextOpts = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    proxy: opts.proxy ? toPlaywrightProxy(opts.proxy) : undefined,
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
}

export async function closeAll() {
  if (_shared) {
    await _shared.close().catch(() => {});
    _shared = null;
  }
}
```

> **备注 (Step 7.3 设计折衷)**: CDP 模式下 Playwright `newContext()` 不接受 `userDataDir`(那是 `launchPersistentContext` 专属)。我们的容器内已经用 supervisord 启了一个共享 Chromium 进程绑定 `--user-data-dir=/profiles/default`,所有 newContext 共享该 profile。
> 这意味着 **MVP 阶段所有账号共用一个 Chromium profile**,实际登录态隔离靠 cookie 在不同账号切换时的覆盖 — 这是个折衷。
> Plan 2 会重构为「每账号拉一个独立的 Chromium 进程」(或用 `chromium.launchPersistentContext` 替代 connectOverCDP)。
> Plan 1 验收:**只绑 1 个小红书账号**,profile 隔离问题不会触发。Plan 2 启动前必修。

- [ ] **Step 7.4: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/platform.ts src/crawler/base.ts src/crawler/browser-pool.ts
git commit -m "feat(phase2): crawler base interface + CDP browser pool (single-profile MVP)"
```

---

## Task 8: 小红书 crawler — selectors + login detector

**Files:**
- Create: `src/crawler/xiaohongshu/selectors.ts`
- Create: `src/crawler/xiaohongshu/login-detector.ts`
- Create: `src/crawler/xiaohongshu/crawler.ts`
- Create: `tests/crawler/xiaohongshu-selectors.test.ts`

- [ ] **Step 8.1: selectors.ts**

```typescript
// 小红书 web 选择器(2026 年 5 月版本)
// 平台改版时,selector miss → crawler 抛 SelectorMissing,任务失败,UI 提示
export const XHS = {
  LOGIN_URL: 'https://www.xiaohongshu.com/login',
  HOME_URL: 'https://www.xiaohongshu.com',
  PROFILE_URL: (uid: string) => `https://www.xiaohongshu.com/user/profile/${uid}`,

  // 已登录后右上角头像 → 取 user uid
  LOGGED_IN_USER_LINK: 'a.user.side-bar-component',  // 假设;实测时可能要改
  LOGGED_IN_PROFILE_HREF_REGEX: /\/user\/profile\/([a-f0-9]+)/,

  // 主页字段
  PROFILE_NICKNAME: '.user-nickname',
  PROFILE_AVATAR: 'img.user-image',
  PROFILE_BIO: '.user-desc',
  PROFILE_FOLLOWER_COUNT: '[data-type="fans"] .count',
  PROFILE_FOLLOWING_COUNT: '[data-type="follows"] .count',
  PROFILE_NOTE_COUNT: '[data-type="notes"] .count',
  PROFILE_LIKE_COUNT: '[data-type="interaction"] .count',

  // 笔记列表
  NOTE_CARD: 'section.note-item',
  NOTE_LINK: 'a.cover',
  NOTE_TITLE: '.title',
  NOTE_LIKE_COUNT: '.like-count',
  NOTE_COVER: '.cover img',
};
```

⚠️ **真实 selector 一定会与上面差异**。本 task 写好接口契约,Task 10 (bind worker) 起来后手动调整。 已在测试和接口里留好「换 selector 不影响调用方」的边界。

- [ ] **Step 8.2: login-detector.ts**

```typescript
import type { Page } from 'playwright-core';
import { XHS } from './selectors';

/**
 * 已登录判定:URL 为非 /login 且能找到用户头像链接(href 含 /user/profile/{uid})
 */
export async function isXiaohongshuLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login') || url.includes('xiaohongshu.com/explore')) return false;
  // 等头像链接出现,3 秒超时(刚加载完时可能还没渲染)
  try {
    await page.waitForSelector(XHS.LOGGED_IN_USER_LINK, { timeout: 3_000, state: 'attached' });
    const href = await page.locator(XHS.LOGGED_IN_USER_LINK).first().getAttribute('href');
    return !!(href && XHS.LOGGED_IN_PROFILE_HREF_REGEX.test(href));
  } catch {
    return false;
  }
}

/** 从已登录用户的链接里解出 platformUid */
export async function extractXiaohongshuUid(page: Page): Promise<string | null> {
  const href = await page
    .locator(XHS.LOGGED_IN_USER_LINK)
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (!href) return null;
  const m = XHS.LOGGED_IN_PROFILE_HREF_REGEX.exec(href);
  return m ? m[1] : null;
}
```

- [ ] **Step 8.3: crawler.ts**

```typescript
import type { BrowserContext, Page } from 'playwright-core';
import type { ICrawler, NoteSummary, ProfileSnapshot } from '../base';
import { XHS } from './selectors';
import { extractXiaohongshuUid, isXiaohongshuLoggedIn } from './login-detector';

export class SelectorMissingError extends Error {
  constructor(selector: string) {
    super(`Selector not found: ${selector}`);
    this.name = 'SelectorMissingError';
  }
}

export const xiaohongshuCrawler: ICrawler = {
  isLoggedIn: isXiaohongshuLoggedIn,

  async scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot> {
    const page = await ctx.newPage();
    await page.goto(XHS.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractXiaohongshuUid(page);
    if (!uid) throw new SelectorMissingError('user uid link');
    await page.goto(XHS.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    const text = async (sel: string): Promise<string> => {
      const t = await page.locator(sel).first().innerText().catch(() => '');
      return t.trim();
    };
    const num = (s: string): number => {
      // 小红书会用 "1.2w" 表示,简单解析
      const m = s.match(/([\d.]+)\s*(w|万)?/);
      if (!m) return 0;
      const n = parseFloat(m[1]);
      return m[2] ? Math.round(n * 10_000) : Math.round(n);
    };

    const nickname = await text(XHS.PROFILE_NICKNAME);
    if (!nickname) throw new SelectorMissingError(XHS.PROFILE_NICKNAME);
    const avatar = await page.locator(XHS.PROFILE_AVATAR).first().getAttribute('src') ?? undefined;
    const bio = (await text(XHS.PROFILE_BIO)) || undefined;
    const followerCount = num(await text(XHS.PROFILE_FOLLOWER_COUNT));
    const followingCount = num(await text(XHS.PROFILE_FOLLOWING_COUNT));
    const noteCount = num(await text(XHS.PROFILE_NOTE_COUNT));
    const likeCount = num(await text(XHS.PROFILE_LIKE_COUNT));

    await page.close();
    return { platformUid: uid, nickname, avatar, bio, followerCount, followingCount, noteCount, likeCount };
  },

  async scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]> {
    const page = await ctx.newPage();
    await page.goto(XHS.HOME_URL, { waitUntil: 'domcontentloaded' });
    const uid = await extractXiaohongshuUid(page);
    if (!uid) throw new SelectorMissingError('user uid link');
    await page.goto(XHS.PROFILE_URL(uid), { waitUntil: 'networkidle' });

    // 滚动加载直到拿够 limit 篇或停滞 3 次
    let stale = 0;
    let prevCount = 0;
    while (stale < 3) {
      const count = await page.locator(XHS.NOTE_CARD).count();
      if (count >= limit) break;
      if (count === prevCount) stale++;
      else { stale = 0; prevCount = count; }
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(800);
    }

    const cards = await page.locator(XHS.NOTE_CARD).all();
    const results: NoteSummary[] = [];
    for (const card of cards.slice(0, limit)) {
      const href = await card.locator(XHS.NOTE_LINK).getAttribute('href').catch(() => null);
      const title = (await card.locator(XHS.NOTE_TITLE).innerText().catch(() => '')).trim();
      const likeText = (await card.locator(XHS.NOTE_LIKE_COUNT).innerText().catch(() => '0')).trim();
      const cover = await card.locator(XHS.NOTE_COVER).getAttribute('src').catch(() => undefined);
      const m = href?.match(/\/explore\/([a-f0-9]+)/);
      if (!m) continue;

      results.push({
        platformNoteId: m[1],
        title,
        type: cover?.includes('video') ? 'VIDEO' : 'IMAGE_TEXT',
        coverUrl: cover ?? undefined,
        tags: [],
        likeCount: parseInt(likeText.replace(/[^\d]/g, ''), 10) || 0,
        commentCount: 0,
        shareCount: 0,
        viewCount: 0,
        collectCount: 0,
        sourceUrl: href ? `https://www.xiaohongshu.com${href}` : undefined,
      });
    }
    await page.close();
    return results;
  },
};
```

- [ ] **Step 8.4: 单测 — login detector 边界**

`tests/crawler/xiaohongshu-selectors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { XHS } from '@/crawler/xiaohongshu/selectors';

describe('XHS selectors', () => {
  it('LOGGED_IN_PROFILE_HREF_REGEX matches profile path', () => {
    expect(XHS.LOGGED_IN_PROFILE_HREF_REGEX.test('/user/profile/5d3a4b1c000000000000abcd')).toBe(true);
    expect(XHS.LOGGED_IN_PROFILE_HREF_REGEX.test('/login')).toBe(false);
  });

  it('PROFILE_URL builds correct uid link', () => {
    expect(XHS.PROFILE_URL('abc123')).toBe('https://www.xiaohongshu.com/user/profile/abc123');
  });
});
```

- [ ] **Step 8.5: 跑测试 + typecheck**

```bash
npm test && npm run typecheck
```

- [ ] **Step 8.6: Commit**

```bash
git add src/crawler/xiaohongshu tests/crawler/xiaohongshu-selectors.test.ts
git commit -m "feat(phase2): xiaohongshu crawler — login detector + profile/notes scraper (selectors v1)"
```

---

## Task 9: bind-session API + GET /api/v1/accounts

**Files:**
- Create: `src/app/api/v1/accounts/bind-session/route.ts`
- Create: `src/app/api/v1/accounts/route.ts`

- [ ] **Step 9.1: POST /api/v1/accounts/bind-session**

```typescript
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { getOrCreateDefaultUser } from '@/lib/user';
import { validateProxyShape, type ProxyConfig } from '@/lib/proxy';
import { bindQueue } from '@/jobs/queue';
import type { Platform } from '@prisma/client';

const ALLOWED_PLATFORMS: Platform[] = ['XIAOHONGSHU', 'DOUYIN'];
const SESSION_TTL_MIN = 8;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    platform?: Platform;
    proxy?: Partial<ProxyConfig> | null;
  } | null;

  if (!body?.platform) return fail('platform required');
  if (!ALLOWED_PLATFORMS.includes(body.platform)) return fail(`unsupported platform: ${body.platform}`);

  let proxyEncrypted: string | null = null;
  if (body.proxy) {
    const err = validateProxyShape(body.proxy);
    if (err) return fail(`proxy invalid: ${err}`);
    proxyEncrypted = encrypt(JSON.stringify(body.proxy));
  }

  const user = await getOrCreateDefaultUser();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60_000);
  const session = await prisma.browserSession.create({
    data: {
      userId: user.id,
      platform: body.platform,
      cdpUrl: process.env.CDP_URL || 'http://localhost:9222',
      vncPath: '',  // 暂留空,Task 12 反代上线后填 `/api/v1/sessions/${id}/vnc`
      proxyTest: proxyEncrypted ? { encrypted: true } : null,
      expiresAt,
    },
  });

  // 把代理(已加密)塞到 job data,worker decrypt
  await bindQueue.add(
    'bind',
    { sessionId: session.id, encryptedProxy: proxyEncrypted },
    { jobId: `bind-${session.id}`, removeOnComplete: true, removeOnFail: false }
  );

  return ok({
    sessionId: session.id,
    vncPath: `/api/v1/sessions/${session.id}/vnc`,
    expiresAt: session.expiresAt.toISOString(),
  });
}
```

- [ ] **Step 9.2: GET /api/v1/accounts**

```typescript
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PLATFORM_META } from '@/lib/platform';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const accounts = await prisma.platformAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { notes: true } } },
  });

  return ok(
    accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      platformLabel: PLATFORM_META[a.platform].label,
      nickname: a.nickname,
      avatar: a.avatar,
      followerCount: a.followerCount,
      followingCount: a.followingCount,
      noteCount: a.noteCount,
      likeCount: a.likeCount,
      loginStatus: a.loginStatus,
      lastSyncAt: a.lastSyncAt,
      isActive: a.isActive,
      cachedNoteCount: a._count.notes,
    }))
  );
}
```

- [ ] **Step 9.3: typecheck + 跑 dev 手动 POST**

```bash
npm run typecheck
# 假设 dev 在跑
curl -X POST http://localhost:3000/api/v1/accounts/bind-session \
  -H 'content-type: application/json' \
  -d '{"platform":"XIAOHONGSHU"}'
```

预期: 返回 `{ success: true, data: { sessionId, vncPath, expiresAt } }`,DB 里 `BrowserSession` 多一条 STARTING 状态。

- [ ] **Step 9.4: Commit**

```bash
git add src/app/api/v1/accounts
git commit -m "feat(phase2): POST /accounts/bind-session creates session + enqueues bind job; GET /accounts lists"
```

---

## Task 10: Bind worker — 登录态检测 + 首次采集

**Files:**
- Create: `src/jobs/workers/bind-worker.ts`
- Create: `src/jobs/workers/index.ts` (启动入口)
- Modify: `package.json` (加 worker:dev script)

- [ ] **Step 10.1: bind-worker.ts**

```typescript
import { Worker, type Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { decrypt } from '@/lib/crypto';
import type { ProxyConfig } from '@/lib/proxy';
import { openContext, closeAll } from '@/crawler/browser-pool';
import { xiaohongshuCrawler } from '@/crawler/xiaohongshu/crawler';
import { PLATFORM_META } from '@/lib/platform';
import { QUEUES } from '@/jobs/queue';

type JobData = { sessionId: string; encryptedProxy: string | null };

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 8 * 60 * 1000;

async function setStatus(sessionId: string, status: import('@prisma/client').SessionStatus) {
  await prisma.browserSession.update({ where: { id: sessionId }, data: { status } });
}

async function handleBind(job: Job<JobData>) {
  const { sessionId, encryptedProxy } = job.data;
  const session = await prisma.browserSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`session ${sessionId} not found`);

  const platform = session.platform;
  const meta = PLATFORM_META[platform];
  const crawler = platform === 'XIAOHONGSHU' ? xiaohongshuCrawler : null;
  if (!crawler) throw new Error(`Plan 1 仅支持小红书,收到 ${platform}`);

  const proxy: ProxyConfig | null = encryptedProxy ? JSON.parse(decrypt(encryptedProxy)) : null;

  await setStatus(sessionId, 'STARTING');
  const ctx = await openContext({ proxy });
  const page = await ctx.newPage();
  await page.goto(meta.loginUrl, { waitUntil: 'domcontentloaded' });
  await setStatus(sessionId, 'WAITING_LOGIN');

  // 轮询登录态
  const startedAt = Date.now();
  let loggedIn = false;
  while (Date.now() - startedAt < MAX_POLL_MS) {
    if (await crawler.isLoggedIn(page)) { loggedIn = true; break; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!loggedIn) {
    await setStatus(sessionId, 'EXPIRED');
    await ctx.close();
    throw new Error('login timeout');
  }

  await setStatus(sessionId, 'SCRAPING');
  try {
    const profile = await crawler.scrapeProfile(ctx);
    const notes = await crawler.scrapeNotes(ctx, 20);

    // upsert PlatformAccount(可能已存在,如重登场景)
    const account = await prisma.platformAccount.upsert({
      where: { platform_platformUid: { platform, platformUid: profile.platformUid } },
      update: {
        nickname: profile.nickname,
        avatar: profile.avatar,
        bio: profile.bio,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        likeCount: profile.likeCount,
        loginStatus: 'VALID',
        lastSyncAt: new Date(),
        proxy: encryptedProxy ? { encrypted: encryptedProxy } : undefined,
      },
      create: {
        userId: session.userId,
        platform,
        platformUid: profile.platformUid,
        nickname: profile.nickname,
        avatar: profile.avatar,
        bio: profile.bio,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        likeCount: profile.likeCount,
        loginStatus: 'VALID',
        lastSyncAt: new Date(),
        proxy: encryptedProxy ? { encrypted: encryptedProxy } : undefined,
      },
    });

    // 写当日 AccountMetric
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    await prisma.accountMetric.upsert({
      where: { accountId_date: { accountId: account.id, date: today } },
      update: {
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        totalLikes: profile.likeCount,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
      },
      create: {
        accountId: account.id,
        date: today,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        totalLikes: profile.likeCount,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
      },
    });

    // 写笔记
    for (const n of notes) {
      await prisma.platformNote.upsert({
        where: { accountId_platformNoteId: { accountId: account.id, platformNoteId: n.platformNoteId } },
        update: {
          title: n.title,
          type: n.type,
          coverUrl: n.coverUrl,
          tags: n.tags,
          likeCount: n.likeCount,
          sourceUrl: n.sourceUrl,
        },
        create: {
          accountId: account.id,
          platformNoteId: n.platformNoteId,
          title: n.title,
          type: n.type,
          coverUrl: n.coverUrl,
          tags: n.tags,
          likeCount: n.likeCount,
          sourceUrl: n.sourceUrl,
        },
      });
    }

    await prisma.browserSession.update({
      where: { id: sessionId },
      data: { status: 'LOGGED_IN', accountId: account.id },
    });
  } finally {
    await ctx.close();
  }
}

export function startBindWorker() {
  const worker = new Worker<JobData>(QUEUES.BIND, handleBind, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[bind-worker] failed', job?.id, err);
  });
  worker.on('completed', (job) => {
    console.log('[bind-worker] completed', job.id);
  });
  return worker;
}
```

- [ ] **Step 10.2: worker 启动入口**

`src/jobs/workers/index.ts`:

```typescript
import 'dotenv/config';
import { startBindWorker } from './bind-worker';
import { closeAll } from '@/crawler/browser-pool';

const bind = startBindWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await bind.close();
  await closeAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: bind');
```

加 `dotenv` 到 dependencies:

```bash
npm install dotenv
```

- [ ] **Step 10.3: 加 worker:dev npm script**

在 `package.json` scripts 加:

```json
"worker:dev": "tsx src/jobs/workers/index.ts"
```

devDependencies 加:

```json
"tsx": "^4.19.2"
```

```bash
npm install
```

- [ ] **Step 10.4: 起 worker 验证 (容器+dev server 都要在跑)**

新开终端:

```bash
npm run worker:dev
```

预期看到:`Workers started: bind`

不退,留着观察后续任务。

- [ ] **Step 10.5: 测试 bind job 投递触发 worker**

另一终端:

```bash
curl -X POST http://localhost:3000/api/v1/accounts/bind-session \
  -H 'content-type: application/json' \
  -d '{"platform":"XIAOHONGSHU"}'
```

预期 worker 日志输出处理过程,容器内 Chromium 打开 xiaohongshu.com/login (此时 noVNC `http://localhost:6080/vnc.html` 应该能看到登录页)。

- [ ] **Step 10.6: Commit**

```bash
git add src/jobs/workers package.json
git commit -m "feat(phase2): bind-worker — poll login state + scrape profile + 20 notes"
```

---

## Task 11: SSE — 实时推送 session status

**Files:**
- Create: `src/lib/sse.ts`
- Create: `src/app/api/v1/sessions/[id]/route.ts`
- Create: `src/app/api/v1/sessions/[id]/events/route.ts`
- Create: `src/app/api/v1/sessions/[id]/cancel/route.ts`

- [ ] **Step 11.1: lib/sse.ts (helper)**

```typescript
export function sseResponse(generator: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const data of generator) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 11.2: GET /api/v1/sessions/[id]**

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await prisma.browserSession.findUnique({ where: { id: params.id } });
  if (!s) return fail('session not found', 404);
  return ok({
    id: s.id,
    platform: s.platform,
    status: s.status,
    accountId: s.accountId,
    expiresAt: s.expiresAt,
  });
}
```

- [ ] **Step 11.3: GET /api/v1/sessions/[id]/events (SSE 轮询 DB)**

MVP 简化: 每秒查一次 DB 推送 status,LOGGED_IN/EXPIRED/ERROR 终止流。

```typescript
import { prisma } from '@/lib/prisma';
import { sseResponse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  async function* gen() {
    let lastStatus: string | null = null;
    const terminal = new Set(['LOGGED_IN', 'EXPIRED', 'ERROR']);
    const startedAt = Date.now();
    const MAX_MS = 10 * 60 * 1000;

    while (Date.now() - startedAt < MAX_MS) {
      const s = await prisma.browserSession.findUnique({
        where: { id },
        select: { status: true, accountId: true },
      });
      if (!s) {
        yield JSON.stringify({ error: 'session not found' });
        return;
      }
      if (s.status !== lastStatus) {
        lastStatus = s.status;
        yield JSON.stringify({ status: s.status, accountId: s.accountId });
      }
      if (terminal.has(s.status)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    yield JSON.stringify({ status: 'TIMEOUT' });
  }
  return sseResponse(gen());
}
```

- [ ] **Step 11.4: POST /api/v1/sessions/[id]/cancel**

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await prisma.browserSession.findUnique({ where: { id: params.id } });
  if (!s) return fail('session not found', 404);
  await prisma.browserSession.update({ where: { id: params.id }, data: { status: 'EXPIRED' } });
  return ok({ id: params.id });
}
```

- [ ] **Step 11.5: typecheck + manual curl SSE**

```bash
npm run typecheck
# 创建一个 session 拿到 id 后
curl -N http://localhost:3000/api/v1/sessions/<id>/events
```

预期看到 `data: {"status":"STARTING"}` 等流。

- [ ] **Step 11.6: Commit**

```bash
git add src/lib/sse.ts src/app/api/v1/sessions
git commit -m "feat(phase2): session APIs — GET/cancel + SSE event stream"
```

---

## Task 12: VNC 反向代理 — Next.js API 路由

**Files:**
- Create: `src/app/api/v1/sessions/[id]/vnc/[...path]/route.ts`
- Modify: `docker-compose.yml` (Task 3 暴露 6080,这里改为不暴露)
- Modify: `.env.example`

- [ ] **Step 12.1: 反代路由 — HTTP + WebSocket**

Next.js 14 App Router 不直接支持 WebSocket。两种选择:
- (A) WebSocket: 用 Next.js `app/api/v1/sessions/[id]/vnc/[...path]/route.ts` 处理 HTTP,但 ws 走独立 server
- (B) 把 noVNC 静态资源 + websockify 都通过 HTTP CONNECT-like reverse-proxy

MVP 简化路线 (推荐):**保留 6080 端口本地暴露**,Next.js 不反代,前端 iframe 直接连 `http://localhost:6080/vnc.html?...`。 反代封装留到 Plan 2 (SaaS 准备时再做)。

具体改:**保留 Step 3.4 的 6080 端口暴露**,删掉本 task 的反代代码计划。

写一个文档化的简短路由作为预留:

```typescript
// src/app/api/v1/sessions/[id]/vnc/[...path]/route.ts
import { fail } from '@/lib/api';

/**
 * VNC 反向代理预留入口。Plan 1 不实现,
 * 前端直接连 process.env.CHROMIUM_VNC_URL (默认 http://localhost:6080)。
 * Plan 2 / SaaS 阶段再补上这里的 WebSocket 反代逻辑。
 */
export async function GET() {
  return fail('VNC reverse proxy not yet implemented; use direct VNC URL in Plan 1', 501);
}
```

- [ ] **Step 12.2: 把 vnc URL 计算逻辑改为读 env**

修改 `src/app/api/v1/accounts/bind-session/route.ts` 中 vncPath 的生成:

找到这行:
```typescript
vncPath: '',
```

改成:
```typescript
vncPath: '', // 给前端构造,见下面 response
```

然后 response 改:
```typescript
return ok({
  sessionId: session.id,
  vncUrl: `${process.env.CHROMIUM_VNC_URL || 'http://localhost:6080'}/vnc.html?autoconnect=1&resize=scale&path=websockify`,
  expiresAt: session.expiresAt.toISOString(),
});
```

(`vncPath` DB 字段先保留,Plan 2 真上反代时用)

- [ ] **Step 12.3: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 12.4: Commit**

```bash
git add src/app/api/v1/sessions/[id]/vnc src/app/api/v1/accounts/bind-session
git commit -m "feat(phase2): VNC URL passthrough (direct connect for Plan 1); reverse-proxy stub for Plan 2"
```

---

## Task 13: UI 基础组件 — Tabs, Progress, Badge

**Files:**
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/progress.tsx`
- Create: `src/components/ui/badge.tsx`

- [ ] **Step 13.1: tabs.tsx (受控,简化版,无 Radix 依赖)**

```typescript
'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Ctx = { value: string; onChange: (v: string) => void };
const TabsCtx = createContext<Ctx | null>(null);

export function Tabs({
  value, onValueChange, children, className,
}: { value: string; onValueChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <TabsCtx.Provider value={{ value, onChange: onValueChange }}>
      <div className={cn('flex flex-col gap-2', className)}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('inline-flex gap-1 rounded-md bg-muted p-1', className)}>{children}</div>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsTrigger outside Tabs');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.onChange(value)}
      className={cn(
        'rounded-sm px-3 py-1 text-sm transition-colors',
        active ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsContent outside Tabs');
  if (ctx.value !== value) return null;
  return <div>{children}</div>;
}
```

- [ ] **Step 13.2: progress.tsx**

```typescript
import { cn } from '@/lib/utils';

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 13.3: badge.tsx**

```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-amber-100 text-amber-700',
        destructive: 'bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 13.4: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 13.5: Commit**

```bash
git add src/components/ui/tabs.tsx src/components/ui/progress.tsx src/components/ui/badge.tsx
git commit -m "feat(phase2): add Tabs / Progress / Badge components"
```

---

## Task 14: 绑定向导 Step 1 (选平台) + Step 2 (代理)

**Files:**
- Create: `src/components/binding/wizard.tsx`
- Create: `src/components/binding/step-platform.tsx`
- Create: `src/components/binding/step-proxy.tsx`

- [ ] **Step 14.1: wizard.tsx 骨架**

```typescript
'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const STEPS = ['选平台', '网络', '登录', '完成'] as const;
type Step = 0 | 1 | 2 | 3;

export interface WizardState {
  platform?: 'XIAOHONGSHU' | 'DOUYIN';
  proxy?: import('@/lib/proxy').ProxyConfig | null;
  sessionId?: string;
  vncUrl?: string;
  accountId?: string;
}

export function Wizard({ children }: { children: (props: {
  step: Step;
  state: WizardState;
  next: (partial?: Partial<WizardState>) => void;
  prev: () => void;
}) => React.ReactNode }) {
  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<WizardState>({});

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs',
              i < step ? 'bg-primary text-primary-foreground' :
              i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>
              {i < step ? '✓' : i + 1}
            </span>
            <span className={cn(i === step ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        ))}
      </ol>
      {children({
        step,
        state,
        next: (partial = {}) => { setState((s) => ({ ...s, ...partial })); setStep((s) => Math.min(3, s + 1) as Step); },
        prev: () => setStep((s) => Math.max(0, s - 1) as Step),
      })}
    </div>
  );
}
```

- [ ] **Step 14.2: step-platform.tsx**

```typescript
'use client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PLATFORMS = [
  { id: 'XIAOHONGSHU' as const, emoji: '🔴', label: '小红书', desc: '图文笔记 · 视频' },
  { id: 'DOUYIN' as const, emoji: '⚫', label: '抖音', desc: '短视频 (Plan 2)', disabled: true },
];

export function StepPlatform({
  selected, onSelect, onNext,
}: { selected?: 'XIAOHONGSHU' | 'DOUYIN'; onSelect: (id: 'XIAOHONGSHU' | 'DOUYIN') => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">选择平台</h2>
      <div className="grid grid-cols-2 gap-3">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={p.disabled}
            onClick={() => onSelect(p.id)}
            className={cn(
              'rounded-lg border bg-card p-6 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              selected === p.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent'
            )}
          >
            <div className="text-3xl">{p.emoji}</div>
            <div className="mt-2 font-semibold">{p.label}</div>
            <div className="text-sm text-muted-foreground">{p.desc}</div>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button disabled={!selected} onClick={onNext}>下一步 →</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 14.3: step-proxy.tsx**

```typescript
'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProxyConfig } from '@/lib/proxy';

export function StepProxy({
  onNext, onBack,
}: { onNext: (proxy: ProxyConfig | null) => void; onBack: () => void }) {
  const [type, setType] = useState<'none' | 'socks5' | 'http' | 'https'>('none');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const buildProxy = (): ProxyConfig | null => {
    if (type === 'none') return null;
    return {
      type,
      host: host.trim(),
      port: parseInt(port, 10),
      username: username || undefined,
      password: password || undefined,
    };
  };

  const handleTest = async () => {
    const p = buildProxy();
    if (!p) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/proxy/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
      });
      const json = await res.json();
      if (json.success) {
        setResult({ ok: true, msg: `✓ 出口 IP: ${json.data.exitIp} (${json.data.latencyMs} ms)` });
      } else {
        setResult({ ok: false, msg: json.message });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">网络出口 (可选)</h2>
      <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
        <TabsList>
          <TabsTrigger value="none">直连</TabsTrigger>
          <TabsTrigger value="socks5">SOCKS5</TabsTrigger>
          <TabsTrigger value="http">HTTP</TabsTrigger>
          <TabsTrigger value="https">HTTPS</TabsTrigger>
        </TabsList>
        <TabsContent value="none">
          <p className="text-sm text-muted-foreground">不使用代理,直接用本机网络。</p>
        </TabsContent>
        {(['socks5', 'http', 'https'] as const).map((t) => (
          <TabsContent key={t} value={t}>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>主机</Label>
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="proxy.example.com" />
                </div>
                <div className="space-y-1">
                  <Label>端口</Label>
                  <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="1080" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>用户名 (可选)</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>密码 (可选)</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" disabled={testing || !host || !port} onClick={handleTest}>
                  {testing ? '测试中...' : '↻ 测试连通'}
                </Button>
                {result && <span className={result.ok ? 'text-green-600 text-sm' : 'text-destructive text-sm'}>{result.msg}</span>}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 上一步</Button>
        <Button onClick={() => onNext(buildProxy())}>{type === 'none' ? '跳过 →' : '下一步 →'}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 14.4: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 14.5: Commit**

```bash
git add src/components/binding/wizard.tsx src/components/binding/step-platform.tsx src/components/binding/step-proxy.tsx
git commit -m "feat(phase2): bind wizard skeleton + step 1 (platform) + step 2 (proxy with test)"
```

---

## Task 15: 向导 Step 3 (noVNC) + Step 4 (完成) + /accounts/bind 页面

**Files:**
- Create: `src/components/binding/step-login.tsx`
- Create: `src/components/binding/step-complete.tsx`
- Create: `src/app/accounts/bind/page.tsx`

- [ ] **Step 15.1: step-login.tsx (noVNC iframe + SSE)**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function StepLogin({
  sessionId, vncUrl, onLoggedIn, onCancel,
}: { sessionId: string; vncUrl: string; onLoggedIn: (accountId: string) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('STARTING');

  useEffect(() => {
    const es = new EventSource(`/api/v1/sessions/${sessionId}/events`);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.status) setStatus(data.status);
      if (data.status === 'LOGGED_IN' && data.accountId) onLoggedIn(data.accountId);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [sessionId, onLoggedIn]);

  const handleCancel = async () => {
    await fetch(`/api/v1/sessions/${sessionId}/cancel`, { method: 'POST' });
    onCancel();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">在嵌入浏览器里登录</h2>
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 overflow-hidden">
          <iframe src={vncUrl} className="h-[500px] w-full border-0" title="noVNC" />
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h3 className="font-semibold">操作指引</h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>打开手机小红书 App</li>
              <li>"我" → 右上扫码图标</li>
              <li>扫左边的二维码</li>
              <li>手机上确认登录</li>
            </ol>
            <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⏳ 等待登录中... <br/>当前状态: <code>{status}</code>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancel}>取消</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 15.2: step-complete.tsx**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function StepComplete({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ nickname: string; followerCount: number; noteCount: number; cachedNoteCount: number } | null>(null);

  useEffect(() => {
    fetch('/api/v1/accounts')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          const a = j.data.find((x: any) => x.id === accountId);
          if (a) setData(a);
        }
      });
  }, [accountId]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">✓ 绑定完成</h2>
      <Card>
        <CardContent className="space-y-3 pt-6">
          {data ? (
            <>
              <div className="text-lg font-semibold">@{data.nickname}</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md bg-muted p-3 text-sm">粉丝 <b>{data.followerCount.toLocaleString()}</b></div>
                <div className="rounded-md bg-muted p-3 text-sm">主页笔记数 <b>{data.noteCount}</b></div>
                <div className="rounded-md bg-muted p-3 text-sm">已抓取 <b>{data.cachedNoteCount}</b></div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">加载账号信息...</p>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => router.push('/accounts')}>完成,去看数据 →</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 15.3: /accounts/bind/page.tsx**

```typescript
'use client';
import { useRouter } from 'next/navigation';
import { Wizard } from '@/components/binding/wizard';
import { StepPlatform } from '@/components/binding/step-platform';
import { StepProxy } from '@/components/binding/step-proxy';
import { StepLogin } from '@/components/binding/step-login';
import { StepComplete } from '@/components/binding/step-complete';

export default function BindAccountPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl">
      <Wizard>
        {({ step, state, next, prev }) => {
          if (step === 0) {
            return (
              <StepPlatform
                selected={state.platform}
                onSelect={(id) => next({ platform: id })}
                onNext={() => next()}
              />
            );
          }
          if (step === 1) {
            return (
              <StepProxy
                onBack={prev}
                onNext={async (proxy) => {
                  const res = await fetch('/api/v1/accounts/bind-session', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ platform: state.platform, proxy }),
                  });
                  const json = await res.json();
                  if (!json.success) { alert(json.message); return; }
                  next({ proxy, sessionId: json.data.sessionId, vncUrl: json.data.vncUrl });
                }}
              />
            );
          }
          if (step === 2 && state.sessionId && state.vncUrl) {
            return (
              <StepLogin
                sessionId={state.sessionId}
                vncUrl={state.vncUrl}
                onLoggedIn={(accountId) => next({ accountId })}
                onCancel={() => router.push('/accounts')}
              />
            );
          }
          if (step === 3 && state.accountId) {
            return <StepComplete accountId={state.accountId} />;
          }
          return <p>状态异常,请重试</p>;
        }}
      </Wizard>
    </div>
  );
}
```

- [ ] **Step 15.4: typecheck + dev 验证 (visually)**

```bash
npm run typecheck
```

浏览器打开 http://localhost:3000/accounts/bind → 应看到 4 步指示器 + Step 1 平台卡片。

- [ ] **Step 15.5: Commit**

```bash
git add src/components/binding src/app/accounts/bind
git commit -m "feat(phase2): bind wizard step 3 (noVNC iframe + SSE) + step 4 (complete) + /accounts/bind page"
```

---

## Task 16: /accounts 卡片网格列表

**Files:**
- Modify: `src/app/accounts/page.tsx`
- Create: `src/components/accounts/account-card.tsx`
- Create: `src/components/accounts/account-grid.tsx`
- Create: `src/components/accounts/empty-state.tsx`

- [ ] **Step 16.1: empty-state.tsx**

```typescript
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4"><UserPlus className="h-8 w-8 text-muted-foreground" /></div>
      <h3 className="mt-4 text-lg font-semibold">还没有绑定账号</h3>
      <p className="mt-1 text-sm text-muted-foreground">点击下方按钮绑定你的第一个账号</p>
      <Link href="/accounts/bind" className="mt-4"><Button>+ 绑定账号</Button></Link>
    </div>
  );
}
```

- [ ] **Step 16.2: account-card.tsx**

```typescript
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Account = {
  id: string;
  platform: 'XIAOHONGSHU' | 'DOUYIN';
  platformLabel: string;
  nickname: string;
  avatar?: string | null;
  followerCount: number;
  followingCount: number;
  noteCount: number;
  likeCount: number;
  loginStatus: 'VALID' | 'EXPIRED' | 'NEVER_LOGGED';
  lastSyncAt?: string | null;
};

const PLATFORM_EMOJI: Record<Account['platform'], string> = { XIAOHONGSHU: '🔴', DOUYIN: '⚫' };

function timeAgo(iso?: string | null): string {
  if (!iso) return '从未同步';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function AccountCard({ account }: { account: Account }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-3">
          {account.avatar
            ? <img src={account.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
            : <div className="h-12 w-12 rounded-full bg-muted" />}
          <div className="flex-1">
            <div className="font-semibold">{PLATFORM_EMOJI[account.platform]} @{account.nickname}</div>
            <div className="text-xs text-muted-foreground">{account.platformLabel} · {timeAgo(account.lastSyncAt)}</div>
          </div>
          {account.loginStatus === 'EXPIRED' && <Badge variant="destructive">⚠ 重登</Badge>}
          {account.loginStatus === 'VALID' && <Badge variant="success">✓</Badge>}
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">粉丝</div><div className="font-semibold">{account.followerCount.toLocaleString()}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">关注</div><div className="font-semibold">{account.followingCount}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">笔记</div><div className="font-semibold">{account.noteCount}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">获赞</div><div className="font-semibold">{account.likeCount.toLocaleString()}</div></div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled>同步 (Plan 2)</Button>
          <Button size="sm" variant="outline" disabled>重登 (Plan 2)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 16.3: account-grid.tsx**

```typescript
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AccountCard } from './account-card';
import { EmptyState } from './empty-state';

export function AccountGrid() {
  const [accounts, setAccounts] = useState<any[] | null>(null);

  useEffect(() => {
    fetch('/api/v1/accounts').then((r) => r.json()).then((j) => {
      if (j.success) setAccounts(j.data);
    });
  }, []);

  if (accounts === null) return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (accounts.length === 0) return <EmptyState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">账号管理</h1>
        <Link href="/accounts/bind"><Button>+ 绑定账号</Button></Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => <AccountCard key={a.id} account={a} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 16.4: page.tsx 用 grid 替换占位**

替换 `src/app/accounts/page.tsx` 整个内容:

```typescript
import { AccountGrid } from '@/components/accounts/account-grid';

export default function AccountsPage() {
  return <AccountGrid />;
}
```

- [ ] **Step 16.5: typecheck + 浏览器看**

```bash
npm run typecheck
```

打开 http://localhost:3000/accounts → 空状态 + [+ 绑定账号] 按钮。

- [ ] **Step 16.6: Commit**

```bash
git add src/components/accounts src/app/accounts/page.tsx
git commit -m "feat(phase2): /accounts cards grid + empty state"
```

---

## Task 17: 清理 + 文档 + Phase 1 placeholder 调整

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Delete: 旧的 `cloak-profiles` volume 引用(已在 Task 3 处理,这里只是补 sanity check)

- [ ] **Step 17.1: README 加 Phase 2 章节**

在 `README.md` 现有 "Phase 1 验收清单" 后追加:

````markdown
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

### Plan 1 验收清单

- [ ] `docker compose up -d chromium` 后 `curl http://localhost:9222/json/version` 返回 Chrome 版本 JSON
- [ ] `http://localhost:6080/vnc.html?autoconnect=1` 能看到容器内 Chromium 桌面
- [ ] 打开 `/accounts/bind` Step 1 平台选择 + Step 2 代理表单 + 测试按钮
- [ ] 选小红书 → 跳过代理 → 看到 noVNC iframe 加载登录页
- [ ] 用真账号扫码登录 → 自动跳 Step 4 显示主页指标
- [ ] `/accounts` 卡片显示该账号 + 4 个指标 + ✓ 状态
- [ ] DB 验证:`SELECT nickname, follower_count FROM "PlatformAccount";` 有记录,`SELECT COUNT(*) FROM "PlatformNote";` ≥ 1

### 已知限制 (Plan 2 处理)

- 单一 Chromium profile,只能绑 1 个账号(切账号会覆盖)
- 没有定时同步,绑定时抓一次后不再更新
- 没有抖音
- VNC 通过 localhost:6080 直连,SaaS 部署需反代
````

- [ ] **Step 17.2: typecheck + lint**

```bash
npm run typecheck
npm run lint
```

预期:零错误。

- [ ] **Step 17.3: Commit**

```bash
git add README.md
git commit -m "docs(phase2): plan 1 acceptance checklist + known limitations"
```

---

## Task 18: 手动 E2E 验收

**No file changes** — 这是手动验证步骤。

- [ ] **Step 18.1: 容器健康检查**

```bash
docker compose ps
# 期望: postgres / redis / chromium 三个都 running, healthy
docker compose logs chromium --tail 50
# 期望: 看到 supervisord 拉起 xvfb/chromium/x11vnc/novnc 四个进程
```

- [ ] **Step 18.2: 起 worker 和 dev**

```bash
# 终端 A
npm run worker:dev
# 终端 B
npm run dev
```

- [ ] **Step 18.3: 浏览器走一遍向导**

1. `http://localhost:3000/accounts` → 空状态,点 [+ 绑定账号]
2. Step 1 选小红书 → Step 2 直连跳过 → Step 3 noVNC iframe 出现 xiaohongshu.com/login
3. 真账号扫码登录
4. 自动跳 Step 4 显示主页信息

- [ ] **Step 18.4: 数据库验证**

```bash
docker exec -it mediapilot-postgres psql -U mediapilot -d mediapilot -c \
  'SELECT id, platform, nickname, follower_count, login_status FROM "PlatformAccount";'

docker exec -it mediapilot-postgres psql -U mediapilot -d mediapilot -c \
  'SELECT COUNT(*) AS notes FROM "PlatformNote";'

docker exec -it mediapilot-postgres psql -U mediapilot -d mediapilot -c \
  'SELECT id, status, expires_at FROM "BrowserSession" ORDER BY created_at DESC LIMIT 5;'
```

期望:
- PlatformAccount 至少 1 条,login_status=VALID
- PlatformNote ≥ 1 (可能 < 20 取决于账号笔记数)
- BrowserSession 最近一条 status=LOGGED_IN

- [ ] **Step 18.5: 已知问题排查**

如果 selector miss 导致 nickname 为空,需要进 noVNC 看页面真实结构,手动调整 `src/crawler/xiaohongshu/selectors.ts`,重启 worker 再试。

- [ ] **Step 18.6: 最终 commit (如有 selector 调整)**

```bash
git add -A
git commit -m "fix(phase2): xhs selectors tuned against live page"
```

---

## 完成标志

- ✅ Task 1–17 commit log 完整
- ✅ Task 18 E2E 验收清单全部通过
- ✅ `npm run typecheck` 零错误
- ✅ `npm test` 全绿

→ **可以进入 Plan 2: 抖音 + 同步引擎 + 重登 + 润色**
