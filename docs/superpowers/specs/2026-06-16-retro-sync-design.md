# Retro Sync (抖音半自动复盘) Design Spec

**Status:** Draft 2026-06-16
**Owner:** MediaPilot (solo dev)
**Phase:** L1 Prediction v2 — Sub-project C

## 1. Goal & Scope

取消 "发布后手动复制抖音 URL 粘回 MediaPilot" 的痛点。 新加 `/content/retro-sync` 页, 一键刷新近期抖音视频, 一键匹配到对应 ContentAnalysis, 立即跑 retro 管线。

**In scope:**

- `src/lib/douyin/list.ts` — `runDouyinListAdapter` + `parseListOutput` (纯函数 TDD)
- `GET /api/v1/douyin/list` — 跑 `review.py list` 子进程, 解析返回 JSON
- `POST /api/v1/content/analyses/[id]/match-douyin` — 写 douyinAwemeId + 立即 enqueue retro
- `/content/retro-sync` RSC 页 + client 表格组件 + match dropdown
- Dashboard 加 1 个 "抖音同步 →" 链接入口

**Out of scope (留 v3):**

- 自动周期性拉取 (cron / BullMQ repeating job)
- 基于 draftTitle fuzzy 自动 match 建议
- 多账号 (现在 default-user)

## 2. Architecture

```
[用户打开 /content/retro-sync]
   ↓
RSC: prisma.contentAnalysis.findMany {
       userId,
       status: 'COMPLETED',
       OR: [{douyinAwemeId: null}, {retroStatus: null}]
     }
   ↓
<RetroSyncTable unmatched={analyses} />  (client)
   ↓
[用户点 "刷新抖音列表"]
   ↓ fetch GET /api/v1/douyin/list
   ↓ 子进程 review.py list → parseListOutput → JSON
   ↓
client: 渲染表格 (douyin 视频 × dropdown 选 unmatched analysis)
   ↓
[用户点某行 "匹配并复盘"]
   ↓ POST /api/v1/content/analyses/[id]/match-douyin { awemeId, postedAt, plays, desc }
   ↓ 写 ContentAnalysis: douyinAwemeId, douyinUrl, publishedAt, retroStatus='SCHEDULED'
   ↓ retroQueue.add('retro', { analysisId }, { delay: 0 })  // immediate
   ↓ ok
   ↓
client: 该行变 "复盘中..." disabled + 跳报告页 link
```

## 3. Data Model

无 schema 变更。 复用现有 `ContentAnalysis.douyinAwemeId`, `douyinUrl`, `publishedAt`, `retroStatus`。

## 4. List 输出解析

cheat-on-content `review.py list` 输出格式 (verified, line 132-135 of review.py):

```
[0] 7234567890123456789  2026-06-10 14:30  播放8.5w  视频标题描述
[1] 7234567890123456788  2026-06-09 12:15  播放3.2k  另一个视频
```

格式: `[INDEX] AWEME_ID  TIME  播放PLAYS  DESC` (双空格分隔)。

```typescript
// src/lib/douyin/list.ts
export interface DouyinListItem {
  awemeId: string;
  postedAt: string;   // 原文 "2026-06-10 14:30"
  plays: string;      // 原文 "8.5w" / "3.2k" / "123"
  desc: string;
}

const LINE_RE = /^\[\d+\]\s+(\S+)\s+(\S+\s\S+)\s+播放(\S+)\s+(.*)$/;

export function parseListOutput(stdout: string): DouyinListItem[] {
  return stdout
    .split('\n')
    .map((line) => line.match(LINE_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      awemeId: m[1],
      postedAt: m[2],
      plays: m[3],
      desc: m[4].trim(),
    }));
}

export async function runDouyinListAdapter(): Promise<DouyinListItem[]> {
  const env = readAdapterEnv();  // 复用 adapter.ts 的 readAdapterEnv
  const { stdout } = await execFileAsync(
    env.pythonBin,
    [path.join(env.adapterPath, 'review.py'), 'list'],
    {
      cwd: env.adapterPath,
      env: { ...process.env, PYTHONPATH: env.contentDir },
      timeout: 60_000,  // 60s, list 没有 video 那么慢
    }
  );
  return parseListOutput(stdout);
}
```

## 5. API Endpoints

### 5.1 `GET /api/v1/douyin/list`

调 `runDouyinListAdapter()`。 成功 → 200 + DouyinListItem[]。 失败 → 500 + 友好 message。

```typescript
export async function GET() {
  try {
    const items = await runDouyinListAdapter();
    return ok(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET douyin/list] failed', e);
    return fail(`抖音列表拉取失败: ${msg}. 请检查 cheat-on-content 是否登录。`, 500);
  }
}
```

### 5.2 `POST /api/v1/content/analyses/[id]/match-douyin`

```typescript
Body: { awemeId: string, postedAt: string, plays: string, desc: string }

Validation:
- analysis 存在且 userId 匹配 default-user
- awemeId 必须正则 /^\d{8,30}$/
- analysis.douyinAwemeId 必须为 null (否则 409)

行为:
- 检查其他 ContentAnalysis 是否已匹配此 awemeId (避免双重匹配, → 409)
- prisma.contentAnalysis.update {
    douyinAwemeId: awemeId,
    douyinUrl: `https://www.douyin.com/video/${awemeId}`,
    publishedAt: parseLooseTime(postedAt) ?? new Date(),
    retroStatus: 'SCHEDULED',
  }
- retroQueue.add('retro', { analysisId }, { jobId: \`retro-${analysisId}\`, delay: 0 })
- Return ok({ retroEnqueued: true })
```

`parseLooseTime("2026-06-10 14:30")` 用 `new Date(str.replace(' ', 'T') + ':00')` 简单解析。 失败兜底 now()。

## 6. UI

### 6.1 RSC `/content/retro-sync/page.tsx`

```typescript
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { RetroSyncTable } from '@/components/content/retro-sync-table';

export default async function RetroSyncPage() {
  const user = await getOrCreateDefaultUser();
  const unmatched = await prisma.contentAnalysis.findMany({
    where: {
      userId: user.id,
      status: 'COMPLETED',
      OR: [{ douyinAwemeId: null }, { retroStatus: null }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, videoFilename: true, draftTitle: true, createdAt: true },
    take: 50,
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">抖音同步</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把发布的抖音视频对应到 MediaPilot 分析, 立即跑复盘。
        </p>
      </div>
      <RetroSyncTable
        unmatched={unmatched.map((a) => ({
          id: a.id,
          videoFilename: a.videoFilename,
          draftTitle: a.draftTitle,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
```

### 6.2 Client `<RetroSyncTable>` 布局

```
┌──────────────────────────────────────────────────────────────────┐
│  [ 🔄 刷新抖音列表 ]      最后刷新: 2026-06-16 14:30 · 12 条       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 抖音 aweme   发布      播放    描述                       │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 7234567...  06-15     8.5w   "ChatGPT 5 个技巧..."        │   │
│  │             [video.mp4 ▾]   [匹配并复盘 →]                │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 7234566...  06-14     1.2w   "AI 工具排行..."             │   │
│  │             已匹配 → over-est.mp4 (灰)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**state:**
- `items: DouyinListItem[]` (前端 fetched)
- `lastFetchAt: Date | null`
- `loading: boolean`
- `inflightMatches: Set<analysisId>` (防重复点击)
- `errors: { aweme: string }[]` (per-row error)
- `bannerError: string | null` (全局拉取错误)

**dropdown:** options = `unmatched` 列表, each `{ id, videoFilename, draftTitle }`. 默认选第 1 个 (最新)。

**已匹配判定:** 前端拉取后, 对每个 item 用 props 里的 `awemeId → ContentAnalysis` 索引判定。 由于这是新页面单次进入, 前端可在 fetch 列表后用一个**额外**的 GET 拉所有 ContentAnalysis 的 (douyinAwemeId, id, videoFilename) 来判定 "已匹配" 状态。 或者更简单: matched 状态只看本会话内 POST 成功的, 已匹配的 awemeId 跨会话刷新会重出现在 dropdown → POST 时 API 返回 409 → UI 显示 "该视频已匹配"。

**简化 v1:** 不查 matched 状态, 只靠 POST 返回 409 兜底。 文案: 一旦点 "匹配并复盘", 如果服务器返回 409 → 行 disabled + 显示错误 inline。

### 6.3 入口

Dashboard `page.tsx` 顶部 `<h1>` 右侧加一个 link:

```typescript
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold">数据总览</h1>
  <Link href="/content/retro-sync">
    <Button size="sm" variant="outline">抖音同步 →</Button>
  </Link>
</div>
```

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| `review.py list` 退出码非 0 (cookie 失效) | API 500 → UI banner "抖音登录失效, 去 cheat-on-content 项目 `python review.py login` 重新扫码" |
| `review.py list` 输出 0 行 | API 200 [] → UI "无最近视频" 空状态 |
| awemeId 被另一 ContentAnalysis 已匹配 | API 409 → UI inline 黄底 "该视频已匹配, 跳过" |
| 立即触发 retro 后 worker 失败 | retroStatus → FAILED, retroErrorMessage 写库 (已有逻辑), UI 跳报告页可看 |
| `CHEAT_ADAPTER_PATH` 未配 | API 500 + "未配置 cheat-on-content adapter 路径" |
| `parseLooseTime` 失败 | publishedAt = now() (容错) |

## 8. Testing

### 8.1 `tests/lib/douyin/list-parser.test.ts` (纯函数)

- ✓ 标准输出 3 行 → 3 个 DouyinListItem
- ✓ 空输出 → []
- ✓ 异常行 (无 `播放` 字段) 跳过
- ✓ desc 含特殊字符 (`|` / Chinese punctuation) 保留
- ✓ aweme_id 19 位数字
- ✓ trim desc 末尾空白

### 8.2 `tests/api/douyin/list.test.ts`

- mock `runDouyinListAdapter` → 200 + items
- mock reject → 500 + cookie 提示

### 8.3 `tests/api/match-douyin.test.ts`

- valid match → 200, prisma.update 调用参数正确, retroQueue.add 调用
- analysis 不存在 → 404
- analysis 已有 douyinAwemeId → 409
- awemeId 不是 8-30 位数字 → 400
- 其他 analysis 已用此 awemeId → 409

### 8.4 不写单测
- RSC page (E2E 覆盖)
- RetroSyncTable client (E2E 覆盖)

### 8.5 手动 E2E

1. **空状态:** 清空 ContentAnalysis 状态后 (或所有都已匹配), 打开页面应正常显示。 点 "刷新" 应能调通 review.py list (前提 cookie 有效)。
2. **匹配成功:** 选某 aweme + 选某 unmatched analysis → 点匹配 → 跳回报告页应看到 "复盘进行中" → 等几分钟 retroReport 写入 → 报告页底部出现 retro 内容。
3. **Cookie 失效:** 故意删 `.auth/` 目录 → 点刷新 → 红色 banner 提示。
4. **重复匹配:** 同一 aweme 二次点 → 409, 黄底提示。

## 9. 完成标志

- ✅ `parseListOutput` 单测 6 个全过
- ✅ API 两路由 8 个单测全过
- ✅ `/content/retro-sync` 渲染 + 刷新 + 匹配 端到端工作
- ✅ Dashboard 顶部出现 "抖音同步 →" 入口
- ✅ typecheck 0 错, npm test 全绿
