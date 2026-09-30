# 选题模块实施计划：对标雷达 + 编导「找选题」

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每晚用 ego lite 大号只读巡检对标账号、按"平时的 3 倍"挑出爆款并自动拆解（转写 + 选题/钩子/标题/契合度）；「选题」页浏览、拆解、粘链接、搜博主、一键建项目；编导能基于对标数据给出 3 个选题，建项目后写稿时借选题/钩子/标题思路但不照抄。

**Architecture:** 抖音访问全部集中在 `src/lib/benchmark/douyin.ts`（经 `ego-browser nodejs` 执行只读脚本），接口 JSON 解析是纯函数；数据读写经 `BenchmarkStore` 接口（Prisma 实现 + 测试用内存实现），巡检/拆解/找选题都是依赖可注入的纯流程。每晚巡检是独立脚本 + launchd（沿用回采模式）；web 进程里的拆解走单并发队列。

**Tech Stack:** Next.js 14 App Router、Prisma 5（`db push`，无 migrations 目录）、zod、vitest + testing-library、ego-browser 0.5（ego lite 默认配置）、本地 faster-whisper、DeepSeek。

**Spec:** `docs/superpowers/specs/2026-09-28-topic-radar-design.md`

## Global Constraints

- 抖音访问身份：ego lite 默认配置（大号），**只读**。`douyin.ts` 里不得出现任何写接口（点赞/关注/评论/私信/收藏）。
- 巡检每晚 ≤ 15 个账号、每账号只读第一页、账号间随机间隔 5～10 秒；连续 3 个账号被拒 → 当晚停止，日志写"疑似触发风控，已停止"。
- 搜博主每天 ≤ 10 次，单次一个词。
- 爆款：点赞 ≥ 平时水平 × 3，且 ≥ 1000，且发布 ≤ 30 天；平时水平 = 该账号库内近 90 天作品点赞中位数，作品 < 3 条时为空（不判爆款）。
- 自动拆解每晚 ≤ 5 条（当晚新判定的爆款按倍数降序）；web 里拆解单并发。
- 下载的视频拆解结束（成功或失败）立即删除，只留文字。
- 播放量拿不到（他人作品恒为 0），界面不显示播放量。
- 照抄：与对标逐字稿连续 12 字以上相同（去标点空白后比较）视为照抄。
- 找选题：近 14 天未忽略爆款 < 2 条时不调模型，直接说明；`sourceVideoIds` 不在输入里的选题整条丢弃。
- 界面不出现内部 id、英文状态码、原始报错；失败文案 = 原因 + 怎么办。
- 测试夹具 `tests/fixtures/douyin/*.json` 已由真实返回裁剪并去掉设备标识（`did`/`iid`/`u_code`），任何新夹具同样处理（仓库公开）。
- 改 schema 后重启 dev（旧 Prisma client 会把新字段读成 undefined）；新增 API 目录后重启 dev。

## Review Focus

1. **ego lite 没开 / 登录过期**：巡检与手动拆解都给出"打开 ego lite 重新登录"，不是空白或英文报错。→ Task 3 测试 `maps an ego failure to EgoUnavailableError`，Task 4 测试 `explains an ego failure in Chinese`。
2. **服务重启时有拆解在跑**：`analysisStatus` 卡在 running 永远转圈。→ Task 8 测试 `marks a stale running analysis as failed`。
3. **同一条作品被粘两次 / 已关注的账号又被搜到**：不得重复建行，也不得把"关注中"降级为"候选"。→ Task 2 测试 `upsertAccount keeps an existing status`。
4. **分享文本里夹着中文和多余字符**（抖音复制出来的是"7.43 复制打开抖音… https://v.douyin.com/xxx/ …"）：能取出链接；不是抖音链接时明确说。→ Task 1 测试 `extracts the url from a share text`。
5. **置顶老作品 / 图文作品混在作品列表**：图文不入库（无法转写）；置顶老作品不因为在第一页就被判为新爆款（超过 30 天）。→ Task 1 测试 `skips image posts`，Task 2 测试 `does not flag an old pinned work`。

---

## 文件结构

```
prisma/schema.prisma                         + BenchmarkAccount, BenchmarkVideo, Project.benchmarkVideoId
src/lib/ego.ts                               runEgo / runEgoResult(从 collect-douyin 抽出, 两处共用)
src/lib/benchmark/parse.ts                   抖音接口 JSON → ParsedWork / ParsedProfile(纯函数)
src/lib/benchmark/link.ts                    分享文本 → 作品 id / 主页 sec_uid
src/lib/benchmark/rules.ts                   平时水平、倍数、爆款判定
src/lib/benchmark/store.ts                   BenchmarkStore 接口 + Prisma 实现
src/lib/benchmark/scan.ts                    applyAccountWorks + runScan(巡检流程)
src/lib/benchmark/douyin.ts                  ego 只读脚本 + DouyinClient
src/lib/benchmark/quota.ts                   搜索每日限额(文件计数)
src/lib/benchmark/analyze.ts                 拆解流程 + Analysis schema
src/lib/benchmark/queue.ts                   web 进程内单并发拆解队列
src/lib/benchmark/deps.ts                    真实依赖装配(whisper / DeepSeek / ego / 人设)
src/lib/benchmark/adopt.ts                   从对标作品建项目
src/lib/benchmark/copy-check.ts              照抄检测
src/lib/benchmark/suggest.ts                 找选题
src/lib/benchmark/view.ts                    给界面的视图
src/lib/douyin/collect-log.ts                泛化为按起止标记解析(回采 + 巡检共用)
src/lib/recording/proofread.ts               + proofreadAgainst(按任意参考文本校对)
src/lib/script/write.ts                      writeScript 可带参考材料
src/lib/tools/{write-script,patch-script,suggest-topics,index}.ts
src/lib/agent/context.ts                     【参考的对标作品】块 + 规则
scripts/scan-benchmarks.ts, scripts/com.mediapilot.scan-benchmarks.plist, scripts/install-scan-cron.sh
src/app/api/topics/...                       videos / accounts / link / suggest
src/app/topics/page.tsx, src/components/topics/*.tsx
src/app/layout.tsx, src/app/page.tsx, src/components/home/account-card.tsx, src/lib/health/checks.ts
tests/helpers/benchmark-store.ts             内存 BenchmarkStore
```

---

### Task 1: 数据表、接口解析、链接解析

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/benchmark/parse.ts`、`src/lib/benchmark/link.ts`
- Test: `tests/lib/benchmark/parse.test.ts`、`tests/lib/benchmark/link.test.ts`（夹具已在 `tests/fixtures/douyin/`）

**Interfaces:**
- Produces（`parse.ts`）：
  - `interface ParsedWork { awemeId: string; desc: string; url: string; publishedAt: Date; durationSec: number; digg: number; comment: number; collect: number; share: number; isTop: boolean; playUrls: string[]; authorSecUid: string; authorName: string }`
  - `interface ParsedProfile { secUid: string; nickname: string; douyinId: string; avatarUrl: string; bio: string; followers: number; totalLikes: number }`
  - `class DouyinRejectedError extends Error`（接口 `status_code ≠ 0` 或结构不对）
  - `parseWorks(json: unknown): { works: ParsedWork[]; hasMore: boolean }`（跳过图文/无视频地址的作品）
  - `parseDetail(json: unknown): ParsedWork`
  - `parseProfile(json: unknown): ParsedProfile`
  - `parseUserSearch(json: unknown): ParsedProfile[]`
- Produces（`link.ts`）：
  - `type LinkTarget = { kind: 'video'; awemeId: string } | { kind: 'user'; secUid: string }`
  - `extractUrl(text: string): string | null`
  - `parseTarget(url: string): LinkTarget | null`
  - `resolveLink(text: string, fetcher?: typeof fetch): Promise<LinkTarget | null>`（`v.douyin.com` 短链跟随跳转，最多 3 跳）

- [ ] **Step 1: schema**

在 `prisma/schema.prisma` 的 `Project` 模型里 `personaSnapshot` 之后加：

```prisma
  /// 从哪条对标作品建的项目(选题模块)
  benchmarkVideoId String?
  benchmarkVideo   BenchmarkVideo? @relation(fields: [benchmarkVideoId], references: [id], onDelete: SetNull)
```

文件末尾追加：

```prisma
/// 对标账号(选题模块)
model BenchmarkAccount {
  id            String    @id @default(cuid())
  secUid        String    @unique
  nickname      String
  douyinId      String    @default("")
  avatarUrl     String    @default("")
  bio           String    @default("") @db.Text
  followers     Int       @default(0)
  totalLikes    Int       @default(0)
  /// following | candidate | ignored
  status        String    @default("candidate")
  /// manual | search | link
  source        String    @default("manual")
  searchKeyword String?
  /// 近 90 天作品点赞中位数; 作品不足 3 条为 null(不判爆款)
  baselineDigg  Int?
  lastCheckedAt DateTime?
  createdAt     DateTime  @default(now())
  videos        BenchmarkVideo[]

  @@index([status, lastCheckedAt])
}

/// 对标作品(选题模块)
model BenchmarkVideo {
  id             String    @id @default(cuid())
  awemeId        String    @unique
  accountId      String
  account        BenchmarkAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  desc           String    @db.Text
  url            String
  publishedAt    DateTime
  durationSec    Int
  digg           Int
  comment        Int
  collect        Int
  share          Int
  /// digg / baselineDigg, 一位小数; 无基线为 null
  ratio          Float?
  isHit          Boolean   @default(false)
  /// 首次判为爆款的时间; 之后跌出爆款也不清空
  hitAt          DateTime?
  /// new | seen | ignored | adopted
  status         String    @default("new")
  /// none | running | done | failed
  analysisStatus String    @default("none")
  analysisError  String?
  transcript     String?   @db.Text
  analysis       Json?
  analyzedAt     DateTime?
  fetchedAt      DateTime  @default(now())
  projects       Project[]

  @@index([isHit, publishedAt])
  @@index([accountId, publishedAt])
}
```

Run: `npx prisma db push && npm run typecheck`
Expected: "Your database is now in sync"；0 错误。

- [ ] **Step 2: 写失败测试**

`tests/lib/benchmark/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import post from '../../fixtures/douyin/post.json';
import profile from '../../fixtures/douyin/profile.json';
import detail from '../../fixtures/douyin/detail.json';
import search from '../../fixtures/douyin/search.json';
import { parseWorks, parseDetail, parseProfile, parseUserSearch, DouyinRejectedError } from '@/lib/benchmark/parse';

describe('parseWorks', () => {
  it('parses stats, dates and play urls', () => {
    const { works, hasMore } = parseWorks(post);
    expect(hasMore).toBe(true);
    const w = works.find((x) => x.awemeId === '7686854197597293859')!;
    expect(w).toMatchObject({ digg: 28149, durationSec: 179, isTop: false, url: 'https://www.douyin.com/video/7686854197597293859', authorName: '园长说AI' });
    expect(w.publishedAt.toISOString()).toBe('2026-09-19T04:01:57.000Z');
    expect(w.playUrls).toHaveLength(2);
  });
  it('skips image posts', () => {
    expect(parseWorks(post).works.map((w) => w.awemeId)).not.toContain('7690000000000000002');
  });
  it('keeps a pinned work but marks it', () => {
    expect(parseWorks(post).works.find((w) => w.awemeId === '7600000000000000001')?.isTop).toBe(true);
  });
  it('rejects a non-zero status_code', () => {
    expect(() => parseWorks({ status_code: 8, aweme_list: [] })).toThrow(DouyinRejectedError);
    expect(() => parseWorks('<html>')).toThrow(DouyinRejectedError);
  });
});

describe('parseProfile / parseDetail / parseUserSearch', () => {
  it('reads followers and likes from the profile', () => {
    expect(parseProfile(profile)).toMatchObject({ nickname: '园长说AI', douyinId: 'Sq19980929', followers: 989815, totalLikes: 22437371 });
  });
  it('reads a single work', () => {
    expect(parseDetail(detail)).toMatchObject({ awemeId: '7676819001574157481', digg: 23417, authorName: '园长说AI' });
  });
  it('reads search results, using short_id when unique_id is empty', () => {
    const users = parseUserSearch(search);
    expect(users).toHaveLength(3);
    expect(users[0]).toMatchObject({ nickname: 'AI课代表小明', followers: 2182666 });
    expect(users[0].secUid).toMatch(/^MS4w/);
  });
});
```

`tests/lib/benchmark/link.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { extractUrl, parseTarget, resolveLink } from '@/lib/benchmark/link';

describe('link parsing', () => {
  it('extracts the url from a share text', () => {
    expect(extractUrl('7.43 复制打开抖音，看看【园长说AI的作品】画面都交给AI了 https://v.douyin.com/iAbCdEf/ Z@m.Dh 08/12 xyz:/')).toBe('https://v.douyin.com/iAbCdEf/');
    expect(extractUrl('没有链接')).toBeNull();
  });
  it('recognizes video and user urls', () => {
    expect(parseTarget('https://www.douyin.com/video/7676819001574157481?previous_page=x')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.iesdouyin.com/share/video/7676819001574157481/?region=CN')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.douyin.com/jingxuan?modal_id=7676819001574157481')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.douyin.com/user/MS4wLjABAAAAo9jpySaV-_x?from_tab_name=main')).toEqual({ kind: 'user', secUid: 'MS4wLjABAAAAo9jpySaV-_x' });
    expect(parseTarget('https://www.bilibili.com/video/BV1')).toBeNull();
  });
  it('follows a short link redirect', async () => {
    const fetcher = vi.fn(async () => ({ status: 302, headers: new Headers({ location: 'https://www.iesdouyin.com/share/video/7676819001574157481/?region=CN' }) }));
    expect(await resolveLink('看看 https://v.douyin.com/iAbCdEf/', fetcher as unknown as typeof fetch)).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
  });
  it('returns null for non-douyin text', async () => {
    expect(await resolveLink('https://example.com/a')).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/benchmark/parse.ts`**

```ts
/**
 * 抖音网页接口 JSON → 本项目的结构。字段来自 2026-09-28 真实返回(见 tests/fixtures/douyin)。
 * 他人作品的 play_count 恒为 0, 不取。
 */
export class DouyinRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DouyinRejectedError';
  }
}

export interface ParsedWork {
  awemeId: string;
  desc: string;
  url: string;
  publishedAt: Date;
  durationSec: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  isTop: boolean;
  playUrls: string[];
  authorSecUid: string;
  authorName: string;
}

export interface ParsedProfile {
  secUid: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  totalLikes: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function envelope(json: unknown): Obj {
  const d = obj(json);
  if (d.status_code !== 0) throw new DouyinRejectedError(`抖音接口返回异常(status_code=${String(d.status_code ?? '无')})`);
  return d;
}

function toWork(raw: unknown): ParsedWork | null {
  const a = obj(raw);
  const playUrls = (obj(obj(a.video).play_addr).url_list as unknown[] | undefined)?.filter((u): u is string => typeof u === 'string') ?? [];
  // 图文作品(aweme_type 68 / 带 images)没有视频, 无法转写
  if (a.images || playUrls.length === 0) return null;
  const s = obj(a.statistics);
  const author = obj(a.author);
  const id = str(a.aweme_id);
  if (!id) return null;
  return {
    awemeId: id,
    desc: str(a.desc),
    url: `https://www.douyin.com/video/${id}`,
    publishedAt: new Date(num(a.create_time) * 1000),
    durationSec: Math.round(num(a.duration) / 1000),
    digg: num(s.digg_count),
    comment: num(s.comment_count),
    collect: num(s.collect_count),
    share: num(s.share_count),
    isTop: a.is_top === 1 || a.is_top === true,
    playUrls,
    authorSecUid: str(author.sec_uid),
    authorName: str(author.nickname),
  };
}

export function parseWorks(json: unknown): { works: ParsedWork[]; hasMore: boolean } {
  const d = envelope(json);
  if (!Array.isArray(d.aweme_list)) throw new DouyinRejectedError('抖音接口没有返回作品列表');
  return { works: d.aweme_list.map(toWork).filter((w): w is ParsedWork => w !== null), hasMore: d.has_more === 1 || d.has_more === true };
}

export function parseDetail(json: unknown): ParsedWork {
  const w = toWork(envelope(json).aweme_detail);
  if (!w) throw new DouyinRejectedError('这条作品不是视频，或已删除、不可见');
  return w;
}

function toProfile(raw: unknown): ParsedProfile {
  const u = obj(raw);
  const uid = str(u.unique_id);
  const short = str(u.short_id);
  return {
    secUid: str(u.sec_uid),
    nickname: str(u.nickname),
    douyinId: uid || (short && short !== '0' ? short : ''),
    avatarUrl: str((obj(u.avatar_thumb).url_list as unknown[] | undefined)?.[0]),
    bio: str(u.signature),
    followers: num(u.follower_count),
    totalLikes: num(u.total_favorited),
  };
}

export function parseProfile(json: unknown): ParsedProfile {
  const p = toProfile(envelope(json).user);
  if (!p.secUid) throw new DouyinRejectedError('抖音接口没有返回博主资料');
  return p;
}

export function parseUserSearch(json: unknown): ParsedProfile[] {
  const d = envelope(json);
  const list = Array.isArray(d.user_list) ? d.user_list : [];
  return list.map((x) => toProfile(obj(x).user_info)).filter((p) => p.secUid && p.nickname);
}
```

- [ ] **Step 5: 实现 `src/lib/benchmark/link.ts`**

```ts
export type LinkTarget = { kind: 'video'; awemeId: string } | { kind: 'user'; secUid: string };

/** 抖音复制出来的分享文本夹着中文和口令, 只取第一个 http(s) 链接 */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s，。！？、"'<>]+/.exec(text);
  return m ? m[0] : null;
}

export function parseTarget(url: string): LinkTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)(douyin|iesdouyin)\.com$/.test(u.hostname)) return null;
  const video = /\/(?:share\/)?(?:video|note)\/(\d{8,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('modal_id') ?? u.searchParams.get('vid');
  if (video && /^\d{8,}$/.test(video)) return { kind: 'video', awemeId: video };
  const user = /\/(?:share\/)?user\/(MS4w[\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('sec_uid');
  if (user && /^MS4w[\w-]+$/.test(user)) return { kind: 'user', secUid: user };
  return null;
}

/** v.douyin.com 短链只会 302 到真实地址, 不需要登录, 所以不走浏览器 */
export async function resolveLink(text: string, fetcher: typeof fetch = fetch): Promise<LinkTarget | null> {
  let url = extractUrl(text);
  for (let hop = 0; url && hop < 4; hop++) {
    const direct = parseTarget(url);
    if (direct) return direct;
    if (!/(^|\.)douyin\.com$/.test(new URL(url).hostname)) return null;
    const res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const next = res.headers.get('location');
    if (!next) return null;
    url = new URL(next, url).toString();
  }
  return null;
}
```

- [ ] **Step 6: 运行确认通过、提交**

Run: `npx vitest run tests/lib/benchmark && npm run typecheck`
Expected: 全部 PASS；0 错误。（`resolveJsonModule` 已开启；若 import json 报错，改用 `JSON.parse(readFileSync(...))` 并记 Ruling。）

```bash
git add prisma/schema.prisma src/lib/benchmark tests/lib/benchmark tests/fixtures/douyin
git commit -m "feat(topics): 对标账号/作品表 + 抖音接口解析 + 分享链接解析

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 爆款规则与数据仓库

**Files:**
- Create: `src/lib/benchmark/rules.ts`、`src/lib/benchmark/store.ts`、`src/lib/benchmark/scan.ts`（本任务只含 `applyAccountWorks`）、`tests/helpers/benchmark-store.ts`
- Test: `tests/lib/benchmark/rules.test.ts`、`tests/lib/benchmark/apply.test.ts`

**Interfaces:**
- Consumes: `ParsedWork`、`ParsedProfile`（Task 1）
- Produces（`rules.ts`）：`HIT_RATIO = 3`、`HIT_MIN_DIGG = 1000`、`HIT_MAX_AGE_DAYS = 30`、`BASELINE_DAYS = 90`、`BASELINE_MIN_WORKS = 3`；`median(xs: number[]): number`；`computeBaseline(works: { digg: number; publishedAt: Date }[], now: Date): number | null`；`judge(w: { digg: number; publishedAt: Date }, baseline: number | null, now: Date): { ratio: number | null; isHit: boolean }`
- Produces（`store.ts`）：
  - `interface AccountRow { id: string; secUid: string; nickname: string; douyinId: string; avatarUrl: string; bio: string; followers: number; totalLikes: number; status: string; source: string; searchKeyword: string | null; baselineDigg: number | null; lastCheckedAt: Date | null; createdAt: Date }`
  - `interface VideoRow { id: string; awemeId: string; accountId: string; desc: string; url: string; publishedAt: Date; durationSec: number; digg: number; comment: number; collect: number; share: number; ratio: number | null; isHit: boolean; hitAt: Date | null; status: string; analysisStatus: string; analysisError: string | null; transcript: string | null; analysis: unknown; analyzedAt: Date | null; fetchedAt: Date }`
  - `interface VideoQuery { accountId?: string; isHit?: boolean; statusNot?: string[]; publishedSince?: Date; hitSince?: Date; analysisStatus?: string; take?: number }`
  - `interface BenchmarkStore { listAccounts(status?: string): Promise<AccountRow[]>; getAccount(id: string): Promise<AccountRow | null>; upsertAccount(p: ParsedProfile, init: { status: string; source: string; searchKeyword?: string }): Promise<AccountRow>; updateAccount(id: string, data: Partial<Pick<AccountRow, 'status' | 'baselineDigg' | 'lastCheckedAt'>>): Promise<void>; upsertVideo(accountId: string, w: ParsedWork, fetchedAt: Date): Promise<VideoRow>; listVideos(q: VideoQuery): Promise<VideoRow[]>; getVideo(id: string): Promise<VideoRow | null>; updateVideo(id: string, data: Partial<Omit<VideoRow, 'id' | 'awemeId' | 'accountId'>>): Promise<void> }`（`listVideos` 按 `publishedAt` 降序；`upsertAccount` 对已存在账号只更新资料，不改 `status/source`）
  - `createPrismaStore(db: PrismaClient): BenchmarkStore`
- Produces（`scan.ts`）：`applyAccountWorks(store: BenchmarkStore, account: AccountRow, profile: ParsedProfile, works: ParsedWork[], now: Date): Promise<{ newWorks: number; newHits: VideoRow[] }>`
- Produces（测试辅助）：`createMemoryStore(): BenchmarkStore & { accounts: AccountRow[]; videos: VideoRow[] }`

- [ ] **Step 1: 写失败测试**

`tests/lib/benchmark/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeBaseline, judge, median } from '@/lib/benchmark/rules';

const now = new Date('2026-09-28T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

describe('rules', () => {
  it('median of odd and even lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('baseline uses only the last 90 days and needs 3 works', () => {
    expect(computeBaseline([{ digg: 100, publishedAt: daysAgo(1) }, { digg: 200, publishedAt: daysAgo(2) }], now)).toBeNull();
    expect(computeBaseline([100, 200, 300].map((d, i) => ({ digg: d, publishedAt: daysAgo(i + 1) })).concat({ digg: 99999, publishedAt: daysAgo(200) }), now)).toBe(200);
  });
  it('flags a recent work at 3x baseline and at least 1000 likes', () => {
    expect(judge({ digg: 3000, publishedAt: daysAgo(3) }, 1000, now)).toEqual({ ratio: 3, isHit: true });
    expect(judge({ digg: 2900, publishedAt: daysAgo(3) }, 1000, now)).toEqual({ ratio: 2.9, isHit: false });
    expect(judge({ digg: 900, publishedAt: daysAgo(3) }, 100, now)).toEqual({ ratio: 9, isHit: false });
  });
  it('does not flag an old pinned work', () => {
    expect(judge({ digg: 90000, publishedAt: daysAgo(45) }, 1000, now).isHit).toBe(false);
  });
  it('gives no ratio without a baseline', () => {
    expect(judge({ digg: 90000, publishedAt: daysAgo(1) }, null, now)).toEqual({ ratio: null, isHit: false });
  });
});
```

`tests/lib/benchmark/apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAccountWorks } from '@/lib/benchmark/scan';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { ParsedProfile, ParsedWork } from '@/lib/benchmark/parse';

const now = new Date('2026-09-28T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const profile: ParsedProfile = { secUid: 'MS4wA', nickname: '园长说AI', douyinId: 'x', avatarUrl: '', bio: '', followers: 1, totalLikes: 2 };
const work = (id: string, digg: number, d: number): ParsedWork => ({
  awemeId: id, desc: `作品${id}`, url: `https://www.douyin.com/video/${id}`, publishedAt: daysAgo(d), durationSec: 60,
  digg, comment: 1, collect: 1, share: 1, isTop: false, playUrls: ['u'], authorSecUid: 'MS4wA', authorName: '园长说AI',
});

describe('applyAccountWorks', () => {
  it('stores works, computes the baseline and reports new hits once', async () => {
    const store = createMemoryStore();
    const acc = await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    const works = [work('1', 1000, 1), work('2', 1200, 5), work('3', 900, 9), work('4', 5000, 2)];
    const r1 = await applyAccountWorks(store, acc, profile, works, now);
    expect(r1.newWorks).toBe(4);
    expect(r1.newHits.map((v) => v.awemeId)).toEqual(['4']);
    expect(store.accounts[0].baselineDigg).toBe(1100);
    expect(store.accounts[0].lastCheckedAt).toEqual(now);
    const hit = store.videos.find((v) => v.awemeId === '4')!;
    expect(hit).toMatchObject({ isHit: true, ratio: 4.5, hitAt: now });
    const r2 = await applyAccountWorks(store, acc, profile, works, new Date(now.getTime() + 86400_000));
    expect(r2.newWorks).toBe(0);
    expect(r2.newHits).toEqual([]);
    expect(store.videos.find((v) => v.awemeId === '4')!.hitAt).toEqual(now);
  });
  it('upsertAccount keeps an existing status', async () => {
    const store = createMemoryStore();
    await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    const again = await store.upsertAccount({ ...profile, followers: 99 }, { status: 'candidate', source: 'search', searchKeyword: 'AI' });
    expect(again).toMatchObject({ status: 'following', source: 'manual', followers: 99 });
    expect(store.accounts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/rules.test.ts tests/lib/benchmark/apply.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/benchmark/rules.ts`**

```ts
/** 爆款 = 比这个账号平时好很多。只看点赞: 他人作品的播放量接口恒为 0。 */
export const HIT_RATIO = 3;
export const HIT_MIN_DIGG = 1000;
export const HIT_MAX_AGE_DAYS = 30;
export const BASELINE_DAYS = 90;
export const BASELINE_MIN_WORKS = 3;

const DAY = 86400_000;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeBaseline(works: { digg: number; publishedAt: Date }[], now: Date): number | null {
  const recent = works.filter((w) => now.getTime() - w.publishedAt.getTime() <= BASELINE_DAYS * DAY).map((w) => w.digg);
  return recent.length >= BASELINE_MIN_WORKS ? Math.round(median(recent)) : null;
}

export function judge(w: { digg: number; publishedAt: Date }, baseline: number | null, now: Date): { ratio: number | null; isHit: boolean } {
  if (!baseline) return { ratio: null, isHit: false };
  const ratio = Math.round((w.digg / baseline) * 10) / 10;
  const fresh = now.getTime() - w.publishedAt.getTime() <= HIT_MAX_AGE_DAYS * DAY;
  return { ratio, isHit: fresh && w.digg >= HIT_MIN_DIGG && w.digg >= baseline * HIT_RATIO };
}
```

- [ ] **Step 4: 实现 `src/lib/benchmark/store.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ParsedProfile, ParsedWork } from './parse';

export interface AccountRow {
  id: string;
  secUid: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  totalLikes: number;
  status: string;
  source: string;
  searchKeyword: string | null;
  baselineDigg: number | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface VideoRow {
  id: string;
  awemeId: string;
  accountId: string;
  desc: string;
  url: string;
  publishedAt: Date;
  durationSec: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  ratio: number | null;
  isHit: boolean;
  hitAt: Date | null;
  status: string;
  analysisStatus: string;
  analysisError: string | null;
  transcript: string | null;
  analysis: unknown;
  analyzedAt: Date | null;
  fetchedAt: Date;
}

export interface VideoQuery {
  accountId?: string;
  isHit?: boolean;
  statusNot?: string[];
  publishedSince?: Date;
  hitSince?: Date;
  analysisStatus?: string;
  take?: number;
}

export interface BenchmarkStore {
  listAccounts(status?: string): Promise<AccountRow[]>;
  getAccount(id: string): Promise<AccountRow | null>;
  /** 已存在的账号只更新资料, 不改 status/source(不把"关注中"降级为"候选") */
  upsertAccount(p: ParsedProfile, init: { status: string; source: string; searchKeyword?: string }): Promise<AccountRow>;
  updateAccount(id: string, data: Partial<Pick<AccountRow, 'status' | 'baselineDigg' | 'lastCheckedAt'>>): Promise<void>;
  upsertVideo(accountId: string, w: ParsedWork, fetchedAt: Date): Promise<VideoRow>;
  /** publishedAt 降序 */
  listVideos(q: VideoQuery): Promise<VideoRow[]>;
  getVideo(id: string): Promise<VideoRow | null>;
  updateVideo(id: string, data: Partial<Omit<VideoRow, 'id' | 'awemeId' | 'accountId'>>): Promise<void>;
}

const profileData = (p: ParsedProfile) => ({
  nickname: p.nickname,
  douyinId: p.douyinId,
  avatarUrl: p.avatarUrl,
  bio: p.bio,
  followers: p.followers,
  totalLikes: p.totalLikes,
});

const statsData = (w: ParsedWork) => ({ desc: w.desc, url: w.url, durationSec: w.durationSec, digg: w.digg, comment: w.comment, collect: w.collect, share: w.share });

export function createPrismaStore(db: PrismaClient): BenchmarkStore {
  return {
    listAccounts: (status) => db.benchmarkAccount.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'asc' } }),
    getAccount: (id) => db.benchmarkAccount.findUnique({ where: { id } }),
    upsertAccount: (p, init) =>
      db.benchmarkAccount.upsert({
        where: { secUid: p.secUid },
        update: profileData(p),
        create: { secUid: p.secUid, ...profileData(p), status: init.status, source: init.source, searchKeyword: init.searchKeyword ?? null },
      }),
    updateAccount: async (id, data) => {
      await db.benchmarkAccount.update({ where: { id }, data });
    },
    upsertVideo: (accountId, w, fetchedAt) =>
      db.benchmarkVideo.upsert({
        where: { awemeId: w.awemeId },
        update: { ...statsData(w), fetchedAt },
        create: { awemeId: w.awemeId, accountId, publishedAt: w.publishedAt, fetchedAt, ...statsData(w) },
      }),
    listVideos: (q) =>
      db.benchmarkVideo.findMany({
        where: {
          accountId: q.accountId,
          isHit: q.isHit,
          status: q.statusNot ? { notIn: q.statusNot } : undefined,
          publishedAt: q.publishedSince ? { gte: q.publishedSince } : undefined,
          hitAt: q.hitSince ? { gte: q.hitSince } : undefined,
          analysisStatus: q.analysisStatus,
        },
        orderBy: { publishedAt: 'desc' },
        take: q.take,
      }),
    getVideo: (id) => db.benchmarkVideo.findUnique({ where: { id } }),
    updateVideo: async (id, data) => {
      await db.benchmarkVideo.update({ where: { id }, data: { ...data, analysis: data.analysis as Prisma.InputJsonValue | undefined } });
    },
  };
}
```

- [ ] **Step 5: 内存实现 `tests/helpers/benchmark-store.ts`**

```ts
import type { AccountRow, BenchmarkStore, VideoRow } from '@/lib/benchmark/store';

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

export function createMemoryStore(): BenchmarkStore & { accounts: AccountRow[]; videos: VideoRow[] } {
  const accounts: AccountRow[] = [];
  const videos: VideoRow[] = [];
  return {
    accounts,
    videos,
    listAccounts: async (status) => accounts.filter((a) => !status || a.status === status).map((a) => ({ ...a })),
    getAccount: async (id) => accounts.find((a) => a.id === id) ?? null,
    upsertAccount: async (p, init) => {
      const hit = accounts.find((a) => a.secUid === p.secUid);
      const profile = { nickname: p.nickname, douyinId: p.douyinId, avatarUrl: p.avatarUrl, bio: p.bio, followers: p.followers, totalLikes: p.totalLikes };
      if (hit) return Object.assign(hit, profile);
      const row: AccountRow = { id: nextId('a'), secUid: p.secUid, ...profile, status: init.status, source: init.source, searchKeyword: init.searchKeyword ?? null, baselineDigg: null, lastCheckedAt: null, createdAt: new Date() };
      accounts.push(row);
      return row;
    },
    updateAccount: async (id, data) => {
      Object.assign(accounts.find((a) => a.id === id)!, data);
    },
    upsertVideo: async (accountId, w, fetchedAt) => {
      const stats = { desc: w.desc, url: w.url, durationSec: w.durationSec, digg: w.digg, comment: w.comment, collect: w.collect, share: w.share, fetchedAt };
      const hit = videos.find((v) => v.awemeId === w.awemeId);
      if (hit) return Object.assign(hit, stats);
      const row: VideoRow = {
        id: nextId('v'), awemeId: w.awemeId, accountId, publishedAt: w.publishedAt, ...stats, ratio: null, isHit: false, hitAt: null,
        status: 'new', analysisStatus: 'none', analysisError: null, transcript: null, analysis: null, analyzedAt: null,
      };
      videos.push(row);
      return row;
    },
    listVideos: async (q) =>
      videos
        .filter(
          (v) =>
            (!q.accountId || v.accountId === q.accountId) &&
            (q.isHit === undefined || v.isHit === q.isHit) &&
            (!q.statusNot || !q.statusNot.includes(v.status)) &&
            (!q.publishedSince || v.publishedAt >= q.publishedSince) &&
            (!q.hitSince || (v.hitAt !== null && v.hitAt >= q.hitSince)) &&
            (!q.analysisStatus || v.analysisStatus === q.analysisStatus),
        )
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, q.take ?? Infinity),
    getVideo: async (id) => videos.find((v) => v.id === id) ?? null,
    updateVideo: async (id, data) => {
      Object.assign(videos.find((v) => v.id === id)!, data);
    },
  };
}
```

- [ ] **Step 6: 实现 `applyAccountWorks`（新建 `src/lib/benchmark/scan.ts`）**

```ts
import type { ParsedProfile, ParsedWork } from './parse';
import type { AccountRow, BenchmarkStore, VideoRow } from './store';
import { computeBaseline, judge } from './rules';

/** 写入一个账号本次读到的资料与作品, 重算平时水平与爆款; 返回本次"新"判定的爆款(hitAt 首次设置) */
export async function applyAccountWorks(
  store: BenchmarkStore,
  account: AccountRow,
  profile: ParsedProfile,
  works: ParsedWork[],
  now: Date,
): Promise<{ newWorks: number; newHits: VideoRow[] }> {
  await store.upsertAccount(profile, { status: account.status, source: account.source });
  const before = new Set((await store.listVideos({ accountId: account.id })).map((v) => v.awemeId));
  for (const w of works) await store.upsertVideo(account.id, w, now);
  const all = await store.listVideos({ accountId: account.id });
  const baseline = computeBaseline(all, now);
  await store.updateAccount(account.id, { baselineDigg: baseline, lastCheckedAt: now });
  const newHits: VideoRow[] = [];
  for (const v of all) {
    const { ratio, isHit } = judge(v, baseline, now);
    const hitAt = isHit && !v.hitAt ? now : v.hitAt;
    if (ratio !== v.ratio || isHit !== v.isHit || hitAt !== v.hitAt) await store.updateVideo(v.id, { ratio, isHit, hitAt });
    if (isHit && !v.hitAt) newHits.push({ ...v, ratio, isHit, hitAt });
  }
  return { newWorks: works.filter((w) => !before.has(w.awemeId)).length, newHits };
}
```

- [ ] **Step 7: 运行确认通过、提交**

Run: `npx vitest run tests/lib/benchmark && npm run typecheck`
Expected: 全部 PASS；0 错误。

```bash
git add src/lib/benchmark tests/lib/benchmark tests/helpers/benchmark-store.ts
git commit -m "feat(topics): 爆款规则(平时水平 x3 / >=1000 / 30 天) + 数据仓库接口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ego 调用抽取、抖音只读客户端、搜索限额

**Files:**
- Create: `src/lib/ego.ts`、`src/lib/benchmark/douyin.ts`、`src/lib/benchmark/quota.ts`
- Modify: `scripts/collect-douyin.ts`（改用 `src/lib/ego.ts` 的 `runEgo`，删除本地副本）
- Test: `tests/lib/benchmark/douyin.test.ts`、`tests/lib/benchmark/quota.test.ts`

**Interfaces:**
- Produces（`ego.ts`）：`EGO_BIN`；`runEgo(script: string, timeoutMs?: number): Promise<string>`（从 collect-douyin 原样搬出）；`class EgoUnavailableError extends Error`；`readResult(output: string): unknown`（取 `@@RESULT@@` 后一行 JSON，找不到抛错）
- Produces（`douyin.ts`）：
  - `type EgoRunner = (script: string) => Promise<string>`
  - `interface DouyinClient { fetchAccount(secUid: string): Promise<{ profile: ParsedProfile; works: ParsedWork[] }>; fetchDetail(awemeId: string): Promise<ParsedWork>; downloadVideo(awemeId: string, destPath: string): Promise<void>; searchUsers(keyword: string): Promise<ParsedProfile[]> }`
  - `createDouyinClient(run?: EgoRunner): DouyinClient`
  - `buildAccountScript(secUid)`、`buildDetailScript(awemeId)`、`buildDownloadScript(awemeId, destPath)`、`buildSearchScript(keyword)`：返回脚本字符串（纯函数，供测试检查）
  - `WRITE_PATTERNS: RegExp`（写接口特征，脚本里一律不得出现）
- Produces（`quota.ts`）：`SEARCH_DAILY_LIMIT = 10`；`takeSearchQuota(file?: string, now?: Date): Promise<boolean>`

- [ ] **Step 1: 写失败测试**

`tests/lib/benchmark/douyin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import post from '../../fixtures/douyin/post.json';
import profile from '../../fixtures/douyin/profile.json';
import search from '../../fixtures/douyin/search.json';
import { buildAccountScript, buildDetailScript, buildDownloadScript, buildSearchScript, createDouyinClient, WRITE_PATTERNS } from '@/lib/benchmark/douyin';
import { EgoUnavailableError, readResult } from '@/lib/ego';
import { DouyinRejectedError } from '@/lib/benchmark/parse';

const SEC = 'MS4wLjABAAAAo9jpySaVTGscShEnsFnqUvUvrycnd8PaeJ8pORefn68';
const out = (v: unknown) => `noise\n@@RESULT@@${JSON.stringify(v)}\n`;

describe('douyin scripts', () => {
  it('only contain read calls', () => {
    for (const s of [buildAccountScript(SEC), buildDetailScript('7676819001574157481'), buildDownloadScript('7676819001574157481', '/tmp/x.mp4'), buildSearchScript('AI工具')]) {
      expect(s).not.toMatch(WRITE_PATTERNS);
      expect(s).toContain('@@RESULT@@');
    }
  });
  it('refuses ids that could break out of the script', () => {
    expect(() => buildAccountScript("x'); evil()")).toThrow();
    expect(() => buildDetailScript('12a')).toThrow();
  });
  it('embeds the keyword as a JSON string', () => {
    expect(buildSearchScript('A"I')).toContain(JSON.stringify('A"I'));
  });
});

describe('createDouyinClient', () => {
  it('parses an account fetch', async () => {
    const c = createDouyinClient(async () => out({ profile: { status: 200, body: JSON.stringify(profile) }, post: { status: 200, body: JSON.stringify(post) } }));
    const r = await c.fetchAccount(SEC);
    expect(r.profile.nickname).toBe('园长说AI');
    expect(r.works.length).toBeGreaterThan(3);
  });
  it('turns a non-200 response into DouyinRejectedError', async () => {
    const c = createDouyinClient(async () => out({ profile: { status: 403, body: '' }, post: { status: 403, body: '' } }));
    await expect(c.fetchAccount(SEC)).rejects.toBeInstanceOf(DouyinRejectedError);
  });
  it('maps an ego failure to EgoUnavailableError', async () => {
    const c = createDouyinClient(async () => {
      throw new Error('退出码 1');
    });
    await expect(c.searchUsers('AI')).rejects.toBeInstanceOf(EgoUnavailableError);
  });
  it('parses search results', async () => {
    const c = createDouyinClient(async () => out({ status: 200, body: JSON.stringify(search) }));
    expect((await c.searchUsers('AI工具'))[0].nickname).toBe('AI课代表小明');
  });
  it('readResult throws when the marker is missing', () => {
    expect(() => readResult('nothing here')).toThrow();
  });
});
```

`tests/lib/benchmark/quota.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { takeSearchQuota, SEARCH_DAILY_LIMIT } from '@/lib/benchmark/quota';

describe('takeSearchQuota', () => {
  it('allows 10 searches a day and resets the next day', async () => {
    const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-q-')), 'q.json');
    const d1 = new Date('2026-09-28T03:00:00Z');
    for (let i = 0; i < SEARCH_DAILY_LIMIT; i++) expect(await takeSearchQuota(f, d1)).toBe(true);
    expect(await takeSearchQuota(f, d1)).toBe(false);
    expect(await takeSearchQuota(f, new Date('2026-09-29T03:00:00Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/douyin.test.ts tests/lib/benchmark/quota.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/ego.ts`**

把 `scripts/collect-douyin.ts` 里的 `runEgo`（连同它上方的注释）原样移入，并加：

```ts
import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';

export const EGO_BIN = path.join(homedir(), '.local/bin/ego-browser');

/** ego lite 没开、登录过期、脚本超时 —— 调用方统一提示"打开 ego lite 重新登录" */
export class EgoUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EgoUnavailableError';
  }
}

// ↓ runEgo 原样搬入(把 spawn(EGO, …) 改成 spawn(EGO_BIN, …)), 并 export
export function runEgo(script: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  /* collect-douyin.ts 中的实现, 一字不改 */
}

const MARKER = '@@RESULT@@';

/** 脚本用 cliLog('@@RESULT@@' + JSON) 输出结果; 取标记后那一行 */
export function readResult(output: string): unknown {
  const i = output.lastIndexOf(MARKER);
  if (i < 0) throw new Error(`ego-browser 没有输出结果标记: ${output.slice(0, 300)}`);
  return JSON.parse(output.slice(i + MARKER.length).split('\n')[0]);
}
```

`scripts/collect-douyin.ts`：删除本地 `EGO` 常量与 `runEgo` 函数，改为 `import { runEgo } from '../src/lib/ego';`（保持原有调用与行为不变；`spawn`/`homedir`/`path` 不再用到的 import 一并删）。

- [ ] **Step 4: 实现 `src/lib/benchmark/douyin.ts`**

```ts
import { EgoUnavailableError, readResult, runEgo } from '@/lib/ego';
import { DouyinRejectedError, parseDetail, parseProfile, parseUserSearch, parseWorks, type ParsedProfile, type ParsedWork } from './parse';

/**
 * 抖音只读访问(ego lite 默认配置 = 用户大号, 2026-09-28 授权只读低频)。
 * 规矩: 这里只允许 GET 读取接口。任何点赞/关注/评论/收藏/私信接口都不得出现 —— 测试用 WRITE_PATTERNS 守门。
 * 所有请求在博主主页/首页里用 page.fetch 发出(带登录 cookie, 实测不需要签名参数)。
 */
export const WRITE_PATTERNS = /commit|digg\/|follow|favorite|collect\/|comment\/publish|im\/|method:\s*['"]POST/i;

const SPACE = '对标雷达';
const Q = 'device_platform=webapp&aid=6383&channel=channel_pc_web';

export type EgoRunner = (script: string) => Promise<string>;

export interface DouyinClient {
  fetchAccount(secUid: string): Promise<{ profile: ParsedProfile; works: ParsedWork[] }>;
  fetchDetail(awemeId: string): Promise<ParsedWork>;
  downloadVideo(awemeId: string, destPath: string): Promise<void>;
  searchUsers(keyword: string): Promise<ParsedProfile[]>;
}

function assertSecUid(s: string): string {
  if (!/^MS4w[\w-]+$/.test(s)) throw new Error(`不是合法的博主 id: ${s.slice(0, 40)}`);
  return s;
}
function assertAwemeId(s: string): string {
  if (!/^\d{8,}$/.test(s)) throw new Error(`不是合法的作品 id: ${s.slice(0, 40)}`);
  return s;
}

const head = (url: string) => `
const task = await taskSpace(${JSON.stringify(SPACE)})
const p = task.page('p1')
await p.goto(${JSON.stringify(url)}, { timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
const get = async (u) => { const r = await p.fetch(u, { credentials: 'include', timeout: 20000 }); return { status: r.status, body: r.body } }
`;

export function buildAccountScript(secUid: string): string {
  const sec = assertSecUid(secUid);
  return `${head(`https://www.douyin.com/user/${sec}`)}
const profile = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/user/profile/other/?${Q}&sec_user_id=${sec}`)})
await new Promise((r) => setTimeout(r, 2000))
const post = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/post/?${Q}&sec_user_id=${sec}&max_cursor=0&count=18`)})
cliLog('@@RESULT@@' + JSON.stringify({ profile, post }))
`;
}

export function buildDetailScript(awemeId: string): string {
  const id = assertAwemeId(awemeId);
  return `${head('https://www.douyin.com/')}
cliLog('@@RESULT@@' + JSON.stringify(await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${Q}&aweme_id=${id}`)})))
`;
}

/** 播放地址会过期, 所以下载前现取详情; 逐个地址尝试 */
export function buildDownloadScript(awemeId: string, destPath: string): string {
  const id = assertAwemeId(awemeId);
  return `${head('https://www.douyin.com/')}
const d = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${Q}&aweme_id=${id}`)})
let saved = false
let lastStatus = d.status
try {
  const urls = JSON.parse(d.body).aweme_detail.video.play_addr.url_list
  for (const u of urls) {
    const r = await p.fetch(u, { saveAs: ${JSON.stringify(destPath)}, timeout: 120000, referrer: 'https://www.douyin.com/' })
    lastStatus = r.status
    if (r.status === 200) { saved = true; break }
  }
} catch (e) { lastStatus = String(e).slice(0, 200) }
cliLog('@@RESULT@@' + JSON.stringify({ saved, lastStatus }))
`;
}

export function buildSearchScript(keyword: string): string {
  const kw = JSON.stringify(keyword);
  return `${head('https://www.douyin.com/')}
await p.goto('https://www.douyin.com/search/' + encodeURIComponent(${kw}) + '?type=user', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
cliLog('@@RESULT@@' + JSON.stringify(await get('https://www.douyin.com/aweme/v1/web/discover/search/?${Q}&search_channel=aweme_user_web&search_source=normal_search&query_correct_type=1&is_filter_search=0&offset=0&count=10&keyword=' + encodeURIComponent(${kw}))))
`;
}

type Raw = { status: number; body: string };

function body(r: Raw): unknown {
  if (r.status !== 200) throw new DouyinRejectedError(`抖音拒绝了请求(HTTP ${r.status})`);
  try {
    return JSON.parse(r.body);
  } catch {
    throw new DouyinRejectedError('抖音返回的不是数据(可能要求验证)');
  }
}

export function createDouyinClient(run: EgoRunner = (s) => runEgo(s, 3 * 60_000)): DouyinClient {
  const exec = async (script: string) => {
    let output: string;
    try {
      output = await run(script);
    } catch (e) {
      throw new EgoUnavailableError('ego lite 没有响应：可能没打开，或抖音登录已过期。打开 ego lite 重新登录一次再试。', { cause: e });
    }
    return readResult(output);
  };
  return {
    async fetchAccount(secUid) {
      const r = (await exec(buildAccountScript(secUid))) as { profile: Raw; post: Raw };
      return { profile: parseProfile(body(r.profile)), works: parseWorks(body(r.post)).works };
    },
    async fetchDetail(awemeId) {
      return parseDetail(body((await exec(buildDetailScript(awemeId))) as Raw));
    },
    async downloadVideo(awemeId, destPath) {
      const r = (await exec(buildDownloadScript(awemeId, destPath))) as { saved: boolean; lastStatus: unknown };
      if (!r.saved) throw new DouyinRejectedError(`视频下载失败(${String(r.lastStatus)})`);
    },
    async searchUsers(keyword) {
      return parseUserSearch(body((await exec(buildSearchScript(keyword))) as Raw));
    },
  };
}
```

- [ ] **Step 5: 实现 `src/lib/benchmark/quota.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

/** 用大号搜博主的每日上限(风控护栏); 计数存在 logs/ 下的小文件里, 不进库 */
export const SEARCH_DAILY_LIMIT = 10;

export async function takeSearchQuota(file = path.join(process.cwd(), 'logs', 'benchmark-search-quota.json'), now = new Date()): Promise<boolean> {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const raw = await fs.readFile(file, 'utf8').catch(() => '');
  let state = { date: today, count: 0 };
  try {
    const s = JSON.parse(raw) as { date?: string; count?: number };
    if (s.date === today) state = { date: today, count: Number(s.count) || 0 };
  } catch {
    /* 文件不存在或损坏: 当作今天第一次 */
  }
  if (state.count >= SEARCH_DAILY_LIMIT) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ date: today, count: state.count + 1 }));
  return true;
}
```

- [ ] **Step 6: 运行确认通过、回采回归、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误（`scripts/` 在 tsconfig include 内，collect-douyin 的改动由 typecheck 覆盖；不实际运行它）。

```bash
git add src/lib/ego.ts src/lib/benchmark tests/lib/benchmark scripts/collect-douyin.ts
git commit -m "feat(topics): 抖音只读客户端(ego 脚本守门: 无写接口) + 搜索每日限额; runEgo 抽到 src/lib/ego.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 拆解流程

**Files:**
- Modify: `src/lib/recording/proofread.ts`（抽出 `proofreadAgainst`）
- Create: `src/lib/benchmark/analyze.ts`、`src/lib/benchmark/queue.ts`、`src/lib/benchmark/deps.ts`
- Test: `tests/lib/recording/proofread-against.test.ts`、`tests/lib/benchmark/analyze.test.ts`、`tests/lib/benchmark/queue.test.ts`

**Interfaces:**
- Consumes: `BenchmarkStore`、`VideoRow`（Task 2）；`DouyinClient`、`EgoUnavailableError`、`DouyinRejectedError`（Task 1/3）；`StructuredLLM`；`TranscriptLine`（`src/lib/recording/transcript.ts`）
- Produces（`proofread.ts`）：`proofreadAgainst(llm: StructuredLLM, reference: { label: string; text: string }, lines: TranscriptLine[]): Promise<ProofreadResult>`；`proofreadLines` 改为调用它（行为不变）
- Produces（`analyze.ts`）：
  - `AnalysisSchema`（zod）、`type Analysis = { topic: string; hook: { quote: string; type: string }; titlePattern: string; fit: 'high' | 'mid' | 'low'; fitReason: string; myAngle: string }`
  - `interface AnalyzeDeps { store: BenchmarkStore; client: Pick<DouyinClient, 'downloadVideo'>; transcribe(videoPath: string): Promise<TranscriptLine[]>; llm: StructuredLLM | null; personaText: string; tmpDir: string; removeFile(p: string): Promise<void> }`
  - `analyzeVideo(deps: AnalyzeDeps, videoId: string): Promise<boolean>`（成功 true；失败写 `analysisError` 返回 false，不抛）
  - `explainAnalyzeError(e: unknown): string`
- Produces（`queue.ts`）：`enqueueAnalysis(videoId: string, run: (id: string) => Promise<unknown>): boolean`（已排队/在跑返回 false）；`isAnalysisActive(videoId: string): boolean`
- Produces（`deps.ts`）：`createAnalyzeDeps(db: PrismaClient): Promise<AnalyzeDeps>`

- [ ] **Step 1: 写失败测试**

`tests/lib/recording/proofread-against.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { proofreadAgainst } from '@/lib/recording/proofread';
import type { StructuredLLM } from '@/lib/script/write';

describe('proofreadAgainst', () => {
  it('uses the given reference label and text', async () => {
    const call = vi.fn(async () => ({ result: { lines: ['被诗人余秀华点名表扬'] }, usage: {} }));
    const llm = { callStructured: call } as unknown as StructuredLLM;
    const r = await proofreadAgainst(llm, { label: '视频文案', text: '#余秀华说AI是普通人的诗' }, [{ startSec: 0, endSec: 2, text: '被诗人于秀华点名表扬' }]);
    expect(r.lines[0].text).toBe('被诗人余秀华点名表扬');
    const msg = (call.mock.calls[0] as unknown as [{ userMessage: { text: string }[] }])[0].userMessage[0].text;
    expect(msg).toContain('【视频文案】\n#余秀华说AI是普通人的诗');
  });
});
```

`tests/lib/benchmark/analyze.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { analyzeVideo, explainAnalyzeError, type AnalyzeDeps } from '@/lib/benchmark/analyze';
import { EgoUnavailableError } from '@/lib/ego';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { StructuredLLM } from '@/lib/script/write';

const analysis = { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签 + 名人背书', fit: 'high', fitReason: '对上内容支柱「效率革命」', myAngle: '用你实测过的工具讲普通人怎么用 AI 解决小问题' };

async function setup(over: Partial<AnalyzeDeps> = {}) {
  const store = createMemoryStore();
  const acc = await store.upsertAccount({ secUid: 'MS4wA', nickname: '园长说AI', douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 }, { status: 'following', source: 'manual' });
  const v = await store.upsertVideo(acc.id, { awemeId: '7676819001574157481', desc: '#余秀华说AI是普通人的诗', url: 'u', publishedAt: new Date(), durationSec: 73, digg: 23417, comment: 0, collect: 0, share: 0, isTop: false, playUrls: [], authorSecUid: 'MS4wA', authorName: '园长说AI' }, new Date());
  const removed: string[] = [];
  const llm = {
    callStructured: vi.fn(async (o: { responseSchema: { safeParse: (x: unknown) => { success: boolean } } }) =>
      o.responseSchema.safeParse({ lines: ['x'] }).success ? { result: { lines: ['很多人对AI的印象还停留在聊天写代码'] }, usage: {} } : { result: analysis, usage: {} },
    ),
  } as unknown as StructuredLLM;
  const deps: AnalyzeDeps = {
    store,
    client: { downloadVideo: vi.fn(async () => {}) },
    transcribe: vi.fn(async () => [{ startSec: 0, endSec: 3, text: '很多人对AI的印象还停留在聊天写代码' }]),
    llm,
    personaText: '内容支柱：效率革命',
    tmpDir: '/tmp',
    removeFile: vi.fn(async (p: string) => {
      removed.push(p);
    }),
    ...over,
  };
  return { store, v, deps, removed };
}

describe('analyzeVideo', () => {
  it('stores transcript and analysis, and deletes the video file', async () => {
    const { store, v, deps, removed } = await setup();
    expect(await analyzeVideo(deps, v.id)).toBe(true);
    expect(store.videos[0]).toMatchObject({ analysisStatus: 'done', analysisError: null, transcript: '很多人对AI的印象还停留在聊天写代码' });
    expect((store.videos[0].analysis as { fit: string }).fit).toBe('high');
    expect(removed).toEqual(['/tmp/bm-7676819001574157481.mp4']);
  });
  it('marks failure with a reason, still deletes the file, and can be retried', async () => {
    const { store, v, deps, removed } = await setup({ transcribe: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await analyzeVideo(deps, v.id)).toBe(false);
    expect(store.videos[0].analysisStatus).toBe('failed');
    expect(store.videos[0].analysisError).toContain('转写失败');
    expect(removed).toHaveLength(1);
    deps.transcribe = vi.fn(async () => [{ startSec: 0, endSec: 3, text: '很多人对AI的印象还停留在聊天写代码' }]);
    expect(await analyzeVideo(deps, v.id)).toBe(true);
    expect(store.videos[0].analysisError).toBeNull();
  });
  it('fails clearly without a DeepSeek key', async () => {
    const { store, v, deps } = await setup({ llm: null });
    expect(await analyzeVideo(deps, v.id)).toBe(false);
    expect(store.videos[0].analysisError).toContain('设置页');
  });
  it('explains an ego failure in Chinese', () => {
    expect(explainAnalyzeError(new EgoUnavailableError('x'))).toContain('打开 ego lite 重新登录');
  });
});
```

`tests/lib/benchmark/queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { enqueueAnalysis, isAnalysisActive } from '@/lib/benchmark/queue';

describe('analysis queue', () => {
  it('runs one at a time and refuses duplicates', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async (id: string) => {
      order.push(`start ${id}`);
      if (id === 'a') await gate;
      order.push(`end ${id}`);
    };
    expect(enqueueAnalysis('a', run)).toBe(true);
    expect(enqueueAnalysis('a', run)).toBe(false);
    expect(enqueueAnalysis('b', run)).toBe(true);
    expect(isAnalysisActive('b')).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start a']);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(isAnalysisActive('a')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/recording/proofread-against.test.ts tests/lib/benchmark/analyze.test.ts tests/lib/benchmark/queue.test.ts`
Expected: FAIL（`proofreadAgainst` 不存在、模块不存在）。

- [ ] **Step 3: `proofreadAgainst`（`src/lib/recording/proofread.ts`）**

把 `SYSTEM_PROMPT` 里"和博主的原稿"改为"和一份参考文本（博主的原稿，或视频自己的文案）"，"不把原话改回原稿"改为"不把原话改回参考文本"。把 `proofreadLines` 函数体替换为：

```ts
export async function proofreadAgainst(llm: StructuredLLM, reference: { label: string; text: string }, lines: TranscriptLine[]): Promise<ProofreadResult> {
  if (!reference.text.trim() || lines.length === 0) return { lines, status: 'skipped', changed: 0 };
  const input = lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n');
  try {
    const { result } = await llm.callStructured({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: [{ type: 'text', text: `【${reference.label}】\n${reference.text}\n\n【识别结果，共 ${lines.length} 行】\n${input}` }],
      responseSchema: ProofreadSchema,
    });
    if (result.lines.length !== lines.length) return { lines, status: 'failed', changed: 0 };
    let changed = 0;
    const out = lines.map((l, i) => {
      const text = acceptCorrection(l.text, result.lines[i]);
      if (text !== l.text) changed++;
      return { ...l, text };
    });
    return { lines: out, status: 'done', changed };
  } catch {
    return { lines, status: 'failed', changed: 0 };
  }
}

export async function proofreadLines(llm: StructuredLLM, script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult> {
  if (!script) return { lines, status: 'skipped', changed: 0 };
  return proofreadAgainst(llm, { label: '原稿', text: script.segments.map((s) => `${ROLE_LABEL[s.role]}：${s.text}`).join('\n') }, lines);
}
```

Run: `npx vitest run tests/lib/recording`
Expected: 全部 PASS（原有校对测试不变，新测试通过）。

- [ ] **Step 4: 实现 `src/lib/benchmark/analyze.ts`**

```ts
import path from 'node:path';
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import type { TranscriptLine } from '@/lib/recording/transcript';
import { proofreadAgainst } from '@/lib/recording/proofread';
import { EgoUnavailableError } from '@/lib/ego';
import { DouyinRejectedError } from './parse';
import type { DouyinClient } from './douyin';
import type { BenchmarkStore } from './store';

export const AnalysisSchema = z.object({
  topic: z.string().min(1),
  hook: z.object({ quote: z.string().min(1), type: z.string().min(1) }),
  titlePattern: z.string().min(1),
  fit: z.enum(['high', 'mid', 'low']),
  fitReason: z.string().min(1),
  myAngle: z.string().min(1),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export interface AnalyzeDeps {
  store: BenchmarkStore;
  client: Pick<DouyinClient, 'downloadVideo'>;
  transcribe(videoPath: string): Promise<TranscriptLine[]>;
  llm: StructuredLLM | null;
  personaText: string;
  tmpDir: string;
  removeFile(p: string): Promise<void>;
}

class StepError extends Error {}

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，负责拆解一条对标爆款，帮博主判断能借什么。
只借三样：选题、开头钩子的写法、标题/文案写法。不评价画面，不复述全文。
- topic：一句话说清这条讲什么（不超过 30 字）。
- hook.quote：视频前 3 秒的原话（从逐字稿开头摘，不改字）；hook.type：钩子写法类型，如 反常识 / 提问 / 数字冲击 / 冲突对比 / 身份代入 / 悬念。
- titlePattern：它的标题和文案是怎么写的（结构，不照抄）。
- fit：这个选题和博主定位的契合度 high / mid / low；fitReason：对上了定位里哪个内容支柱或痛点，或为什么不合适（踩了忌讳也要说）。
- myAngle：博主可以怎么讲这个选题（一两句）。不得替博主编造经历、测试结果或数据。
只输出 JSON。`;

export function explainAnalyzeError(e: unknown): string {
  if (e instanceof EgoUnavailableError) return '下载视频时 ego lite 没有响应：打开 ego lite 重新登录一次，再点重试。';
  if (e instanceof DouyinRejectedError) return `抖音没有给视频（${e.message}）。可能作品已删除或设为私密；稍后点重试。`;
  if (e instanceof StepError) return e.message;
  return '拆解中途出错了，点重试再来一次。';
}

export async function analyzeVideo(deps: AnalyzeDeps, videoId: string): Promise<boolean> {
  const v = await deps.store.getVideo(videoId);
  if (!v) return false;
  await deps.store.updateVideo(videoId, { analysisStatus: 'running', analysisError: null });
  const file = path.join(deps.tmpDir, `bm-${v.awemeId}.mp4`);
  try {
    if (!deps.llm) throw new StepError('没有配置 DeepSeek key，拆解需要它：去设置页填入后点重试。');
    await deps.client.downloadVideo(v.awemeId, file);
    let lines: TranscriptLine[];
    try {
      lines = await deps.transcribe(file);
    } catch (e) {
      throw new StepError('转写失败：本地转写没跑起来，去设置页看「本地转写」体检项，修好后点重试。', { cause: e });
    }
    if (lines.length === 0) throw new StepError('转写结果是空的：这条视频可能没有人声。');
    const proof = await proofreadAgainst(deps.llm, { label: '视频文案', text: v.desc }, lines);
    const transcript = proof.lines.map((l) => l.text).join('\n');
    let analysis: Analysis;
    try {
      const { result } = await deps.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [{ type: 'text', text: `【博主定位】\n${deps.personaText || '（未填写）'}\n\n【对标视频文案】\n${v.desc}\n\n【逐字稿】\n${transcript}` }],
        responseSchema: AnalysisSchema,
      });
      analysis = result;
    } catch (e) {
      throw new StepError('DeepSeek 这次没按格式交回拆解，点重试再来一次。', { cause: e });
    }
    await deps.store.updateVideo(videoId, { analysisStatus: 'done', analysisError: null, transcript, analysis, analyzedAt: new Date() });
    return true;
  } catch (e) {
    await deps.store.updateVideo(videoId, { analysisStatus: 'failed', analysisError: explainAnalyzeError(e) });
    return false;
  } finally {
    await deps.removeFile(file).catch(() => {});
  }
}
```

- [ ] **Step 5: 实现 `src/lib/benchmark/queue.ts`**

```ts
/**
 * web 进程内的拆解队列: 一次一条(本地转写吃满 CPU, 并发只会一起变慢)。
 * 放在 globalThis 上, dev 热更新不丢队列。服务重启后队列清空 —— 残留的 running 由列表接口改成失败(见 Task 8)。
 */
type Q = { chain: Promise<void>; active: Set<string> };
const g = globalThis as unknown as { __mpAnalysisQueue?: Q };
const q: Q = (g.__mpAnalysisQueue ??= { chain: Promise.resolve(), active: new Set() });

export function isAnalysisActive(videoId: string): boolean {
  return q.active.has(videoId);
}

export function enqueueAnalysis(videoId: string, run: (id: string) => Promise<unknown>): boolean {
  if (q.active.has(videoId)) return false;
  q.active.add(videoId);
  q.chain = q.chain
    .then(() => run(videoId))
    .catch(() => {})
    .finally(() => {
      q.active.delete(videoId);
    });
  return true;
}
```

- [ ] **Step 6: 实现 `src/lib/benchmark/deps.ts`**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { createDouyinClient } from './douyin';
import { createPrismaStore } from './store';
import type { AnalyzeDeps } from './analyze';

export async function createAnalyzeDeps(db: PrismaClient): Promise<AnalyzeDeps> {
  const key = getDeepSeekKey();
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const whisper = new LocalWhisperClient();
  return {
    store: createPrismaStore(db),
    client: createDouyinClient(),
    transcribe: async (p) => (await whisper.transcribe(p)).segments.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })),
    llm: key ? new DeepSeekTextLLM({ apiKey: key }) : null,
    personaText: formatPersona(persona as PersonaLike | null),
    tmpDir: os.tmpdir(),
    removeFile: (p) => fs.unlink(p),
  };
}
```

（`TranscriptSegment` 字段名以 `src/lib/llm/whisper.ts` 为准；若为 `start/end`，按实际映射并记 Ruling。）

- [ ] **Step 7: 运行确认通过、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

```bash
git add src/lib/recording/proofread.ts src/lib/benchmark tests/lib/recording/proofread-against.test.ts tests/lib/benchmark
git commit -m "feat(topics): 拆解流程(下载→转写→按文案校对→拆选题/钩子/标题/契合度, 视频用完即删) + 单并发队列

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 每晚巡检（脚本、launchd、日志、首页与体检）

**Files:**
- Modify: `src/lib/benchmark/scan.ts`（加 `runScan`）、`src/lib/douyin/collect-log.ts`（泛化）、`src/lib/health/checks.ts`、`src/app/api/settings/health/route.ts`、`src/app/page.tsx`、`src/components/home/account-card.tsx`、`src/lib/account/summary.ts`、`package.json`
- Create: `scripts/scan-benchmarks.ts`、`scripts/com.mediapilot.scan-benchmarks.plist`、`scripts/install-scan-cron.sh`
- Test: `tests/lib/benchmark/scan.test.ts`、`tests/lib/douyin/collect-log.test.ts`（加用例）、`tests/lib/health/checks.test.ts`（改）、`tests/components/account-card.test.tsx`（加用例）

**Interfaces:**
- Consumes: `applyAccountWorks`、`BenchmarkStore`（Task 2）；`DouyinClient`、`EgoUnavailableError`、`DouyinRejectedError`（Task 3）
- Produces（`scan.ts`）：
  - `MAX_ACCOUNTS_PER_NIGHT = 15`、`MAX_AUTO_ANALYZE = 5`、`STOP_AFTER_REJECTS = 3`
  - `interface ScanDeps { store: BenchmarkStore; client: Pick<DouyinClient, 'fetchAccount'>; analyze(videoId: string): Promise<boolean>; log(msg: string): void; sleep(ms: number): Promise<void>; now(): Date; random(): number }`
  - `runScan(deps: ScanDeps): Promise<{ accounts: number; failed: number; newWorks: number; hits: number; analyzed: number; stopped: boolean }>`
- Produces（`collect-log.ts`）：`interface RunLogSpec { start: string; done: string; noun: string; install: string; checkCmd: string }`；`COLLECT_SPEC`、`SCAN_SPEC`；`parseRunLog(text, now, spec): CollectStatus`；`parseCollectLog(text, now)` 保持原签名 = `parseRunLog(text, now, COLLECT_SPEC)`；`readScanStatus(now?, file?)`
- Produces（`summary.ts`）：`AccountSummary` 加 `hits24h: number`、`scan: CollectStatus`；`buildAccountSummary(db, collect, scan)`
- Produces（`checks.ts`）：`runHealthChecks` 的 deps 加 `scan: CollectStatus`，多一项 `{ key: 'scan', label: '对标巡检' }`

- [ ] **Step 1: 写失败测试**

`tests/lib/benchmark/scan.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runScan, type ScanDeps } from '@/lib/benchmark/scan';
import { DouyinRejectedError, type ParsedWork } from '@/lib/benchmark/parse';
import { EgoUnavailableError } from '@/lib/ego';
import { createMemoryStore } from '../../helpers/benchmark-store';

const now = new Date('2026-09-28T12:30:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const work = (id: string, digg: number, d: number): ParsedWork => ({ awemeId: id, desc: id, url: 'u', publishedAt: daysAgo(d), durationSec: 60, digg, comment: 0, collect: 0, share: 0, isTop: false, playUrls: ['u'], authorSecUid: '', authorName: '' });
const prof = (sec: string) => ({ secUid: sec, nickname: sec, douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 });

async function setup(n: number, fetchAccount: ScanDeps['client']['fetchAccount']) {
  const store = createMemoryStore();
  for (let i = 0; i < n; i++) await store.upsertAccount(prof(`MS4w${i}`), { status: 'following', source: 'manual' });
  const logs: string[] = [];
  const deps: ScanDeps = { store, client: { fetchAccount }, analyze: vi.fn(async () => true), log: (m) => logs.push(m), sleep: vi.fn(async () => {}), now: () => now, random: () => 0.5 };
  return { store, deps, logs };
}

describe('runScan', () => {
  it('checks following accounts, sleeps between them, auto-analyzes new hits', async () => {
    const { deps, logs } = await setup(2, async (sec) => ({ profile: prof(sec), works: [work(`${sec}-1`, 1000, 1), work(`${sec}-2`, 1000, 2), work(`${sec}-3`, 1000, 3), work(`${sec}-4`, 9000, 1)] }));
    const r = await runScan(deps);
    expect(r).toMatchObject({ accounts: 2, failed: 0, hits: 2, analyzed: 2, stopped: false });
    expect(deps.sleep).toHaveBeenCalledWith(7500);
    expect(logs[0]).toBe('开始巡检');
    expect(logs.at(-1)).toBe('巡检完成: 账号 2 个(失败 0) / 新作品 8 条 / 爆款 2 条 / 拆解 2 条');
  });
  it('keeps going when one account fails', async () => {
    const { deps, logs } = await setup(3, async (sec) => {
      if (sec === 'MS4w1') throw new DouyinRejectedError('抖音拒绝了请求(HTTP 403)');
      return { profile: prof(sec), works: [] };
    });
    const r = await runScan(deps);
    expect(r).toMatchObject({ accounts: 3, failed: 1, stopped: false });
    expect(logs.some((l) => l.includes('MS4w1') && l.includes('HTTP 403'))).toBe(true);
  });
  it('stops after 3 rejections in a row', async () => {
    const { deps, logs } = await setup(5, async () => {
      throw new DouyinRejectedError('抖音拒绝了请求(HTTP 403)');
    });
    const r = await runScan(deps);
    expect(r.stopped).toBe(true);
    expect(logs.some((l) => l.includes('疑似触发风控，已停止'))).toBe(true);
    expect(logs.at(-1)).not.toContain('巡检完成');
  });
  it('stops at once when ego is unavailable', async () => {
    const { deps, logs } = await setup(3, async () => {
      throw new EgoUnavailableError('ego lite 没有响应');
    });
    const r = await runScan(deps);
    expect(r).toMatchObject({ stopped: true, failed: 1 });
    expect(logs.some((l) => l.startsWith('ego lite 没有响应'))).toBe(true);
  });
  it('analyzes at most 5 new hits, highest ratio first', async () => {
    const { deps } = await setup(1, async (sec) => ({ profile: prof(sec), works: [1, 2, 3, 4, 5, 6, 7].map((i) => work(`b${i}`, 1000, i)).concat([1, 2, 3, 4, 5, 6].map((i) => work(`h${i}`, 3000 + i * 1000, 1))) }));
    await runScan(deps);
    expect(deps.analyze).toHaveBeenCalledTimes(5);
  });
});
```

在 `tests/lib/douyin/collect-log.test.ts` 末尾追加：

```ts
import { parseRunLog, SCAN_SPEC } from '@/lib/douyin/collect-log';

describe('parseRunLog with the scan spec', () => {
  it('uses scan markers and wording', () => {
    const text = '[2026-09-28T12:30:00.000Z] 开始巡检\n[2026-09-28T12:31:00.000Z] 疑似触发风控，已停止(连续 3 个账号被拒)\n';
    const s = parseRunLog(text, now, SCAN_SPEC);
    expect(s.state).toBe('failing');
    expect(s.hint).toBe('连续 1 次对标巡检失败：疑似触发风控，已停止(连续 3 个账号被拒)');
  });
});
```

`tests/lib/health/checks.test.ts`：`deps()` 默认值加 `scan: okCollect`；"healthy machine" 用例期望末尾追加 `['scan', 'ok']`；"actionable fix" 用例 `deps({...})` 里加 `scan: { ...okCollect, state: 'never', hint: '还没有巡检日志。' }` 并断言 `expect(by.scan).toMatchObject({ status: 'warn', detail: '还没有巡检日志。' })`。

`tests/components/account-card.test.tsx`：`base` 加 `hits24h: 0, scan: base.collect`（在对象内写成 `scan: { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' }`），并加：

```tsx
  it('links to today\'s benchmark hits', () => {
    render(<AccountCard summary={{ ...base, hits24h: 3 }} />);
    expect(screen.getByRole('link', { name: '今天对标里有 3 条爆款 →' }).getAttribute('href')).toBe('/topics');
  });
  it('warns when the benchmark scan fails', () => {
    render(<AccountCard summary={{ ...base, scan: { ...base.scan, state: 'failing', hint: '连续 1 次对标巡检失败：ego lite 没有响应' } }} />);
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join()).toContain('对标巡检失败');
  });
```

`tests/lib/account/summary.test.ts`：所有 `buildAccountSummary(db(...), collect)` 改为 `buildAccountSummary(db(...), collect, collect)`；`db()` 里加 `benchmarkVideo: { count: async () => 2 }`，并在第一个用例断言 `expect(s.hits24h).toBe(2)`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/scan.test.ts tests/lib/douyin tests/lib/health tests/components/account-card.test.tsx tests/lib/account`
Expected: FAIL（`runScan`/`parseRunLog`/`hits24h` 不存在）。

- [ ] **Step 3: `runScan`（追加到 `src/lib/benchmark/scan.ts`）**

```ts
import { EgoUnavailableError } from '@/lib/ego';
import { DouyinRejectedError } from './parse';
import type { DouyinClient } from './douyin';

export const MAX_ACCOUNTS_PER_NIGHT = 15;
export const MAX_AUTO_ANALYZE = 5;
export const STOP_AFTER_REJECTS = 3;

export interface ScanDeps {
  store: BenchmarkStore;
  client: Pick<DouyinClient, 'fetchAccount'>;
  analyze(videoId: string): Promise<boolean>;
  log(msg: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  random(): number;
}

/** 每晚巡检。只读、限量、有间隔; 被连续拒绝就停, 不硬撞风控。 */
export async function runScan(deps: ScanDeps) {
  deps.log('开始巡检');
  const accounts = (await deps.store.listAccounts('following'))
    .sort((a, b) => (a.lastCheckedAt?.getTime() ?? 0) - (b.lastCheckedAt?.getTime() ?? 0))
    .slice(0, MAX_ACCOUNTS_PER_NIGHT);
  const r = { accounts: 0, failed: 0, newWorks: 0, hits: 0, analyzed: 0, stopped: false };
  const hits: VideoRow[] = [];
  let rejects = 0;
  for (const [i, acc] of accounts.entries()) {
    if (i > 0) await deps.sleep(5000 + Math.round(deps.random() * 5000));
    r.accounts++;
    try {
      const { profile, works } = await deps.client.fetchAccount(acc.secUid);
      const a = await applyAccountWorks(deps.store, acc, profile, works, deps.now());
      r.newWorks += a.newWorks;
      hits.push(...a.newHits);
      rejects = 0;
    } catch (e) {
      r.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof EgoUnavailableError) {
        deps.log(msg);
        r.stopped = true;
        break;
      }
      deps.log(`账号 ${acc.nickname}(${acc.secUid}) 巡检失败: ${msg}`);
      if (e instanceof DouyinRejectedError && ++rejects >= STOP_AFTER_REJECTS) {
        deps.log(`疑似触发风控，已停止(连续 ${STOP_AFTER_REJECTS} 个账号被拒)`);
        r.stopped = true;
        break;
      }
    }
  }
  r.hits = hits.length;
  if (r.stopped) return r;
  const toAnalyze = hits.filter((h) => h.analysisStatus === 'none').sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, MAX_AUTO_ANALYZE);
  for (const h of toAnalyze) if (await deps.analyze(h.id)) r.analyzed++;
  deps.log(`巡检完成: 账号 ${r.accounts} 个(失败 ${r.failed}) / 新作品 ${r.newWorks} 条 / 爆款 ${r.hits} 条 / 拆解 ${r.analyzed} 条`);
  return r;
}
```

（`VideoRow` 已在文件顶部 import。）

- [ ] **Step 4: 日志解析泛化（`src/lib/douyin/collect-log.ts`）**

在文件内新增并改造（`parseCollectLog`、`readCollectStatus` 的对外行为不变）：

```ts
export interface RunLogSpec {
  start: string;
  done: string;
  noun: string;
  install: string;
  checkCmd: string;
}

export const COLLECT_SPEC: RunLogSpec = {
  start: '开始回采',
  done: '回采完成',
  noun: '回采',
  install: '在项目目录运行 sh scripts/install-collect-cron.sh 装上每晚 20:00 的回采，或先手动运行 npm run collect:douyin。',
  checkCmd: 'launchctl list | grep mediapilot',
};

export const SCAN_SPEC: RunLogSpec = {
  start: '开始巡检',
  done: '巡检完成',
  noun: '对标巡检',
  install: '在项目目录运行 sh scripts/install-scan-cron.sh 装上每晚 20:30 的对标巡检，或先手动运行 npm run scan:benchmarks。',
  checkCmd: 'launchctl list | grep scan-benchmarks',
};
```

把 `parseCollectLog(text, now)` 改名为 `parseRunLog(text, now, spec)`，函数体内：`'开始回采'` → `spec.start`，`'回采完成'` → `spec.done`，`INSTALL` → `spec.install`，提示语中的"回采"改用 `spec.noun`（`还没有${spec.noun}记录。`、`连续 ${n} 次${spec.noun}失败：…`、`超过 36 小时没有成功${spec.noun}（上次 …）。检查定时任务是否还在：${spec.checkCmd}`），并保留原有的数据库补救提示。然后：

```ts
export function parseCollectLog(text: string, now: Date): CollectStatus {
  return parseRunLog(text, now, COLLECT_SPEC);
}

async function readRunStatus(file: string, now: Date, spec: RunLogSpec): Promise<CollectStatus> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return { state: 'never', lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, hint: `还没有${spec.noun}日志。${spec.install}` };
  return parseRunLog(text, now, spec);
}

export function readCollectStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'collect-douyin.log')) {
  return readRunStatus(file, now, COLLECT_SPEC);
}

export function readScanStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'scan-benchmarks.log')) {
  return readRunStatus(file, now, SCAN_SPEC);
}
```

注意：原测试断言的文案（`连续 2 次回采失败`、`超过 36 小时没有成功回采`、`sh scripts/install-collect-cron.sh`、`docker compose up -d`）必须保持通过。

- [ ] **Step 5: 首页与体检**

`src/lib/account/summary.ts`：`AccountSummary` 加

```ts
  /** 近 24 小时新判定的对标爆款数 */
  hits24h: number;
  scan: CollectStatus;
```

`buildAccountSummary(db, collect, scan)`：`Promise.all` 里加 `db.benchmarkVideo.count({ where: { hitAt: { gte: new Date(Date.now() - 86400_000) } } })`，返回对象加 `hits24h`、`scan`。

`src/components/home/account-card.tsx`：顶部 `import Link from 'next/link';`；告警区改为同时显示回采与巡检（两条各自独立的 `role="alert"`，状态为 `ok` 的不显示）；在 `<p className="mt-2 …">` 之后加：

```tsx
      <Link href="/topics" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">
        {s.hits24h > 0 ? `今天对标里有 ${s.hits24h} 条爆款 →` : '今天对标没有新爆款 →'}
      </Link>
```

`src/app/page.tsx`：`readCollectStatus().then(...)` 改为 `Promise.all([readCollectStatus(), readScanStatus()]).then(([c, s]) => buildAccountSummary(prisma, c, s))`，import `readScanStatus`。

`src/lib/health/checks.ts`：deps 加 `scan: CollectStatus`；在回采项之后加：

```ts
  items.push(
    deps.scan.state === 'ok'
      ? { key: 'scan', label: '对标巡检', status: 'ok', detail: `上次成功：${new Date(deps.scan.lastSuccessAt!).toLocaleString('zh-CN')}` }
      : { key: 'scan', label: '对标巡检', status: 'warn', detail: deps.scan.hint },
  );
```

`src/app/api/settings/health/route.ts`：传 `scan: await readScanStatus()`。

- [ ] **Step 6: 脚本与定时任务**

`scripts/scan-benchmarks.ts`:

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runScan } from '../src/lib/benchmark/scan';
import { createPrismaStore } from '../src/lib/benchmark/store';
import { createDouyinClient } from '../src/lib/benchmark/douyin';
import { analyzeVideo } from '../src/lib/benchmark/analyze';
import { createAnalyzeDeps } from '../src/lib/benchmark/deps';

/**
 * 每晚 20:30 巡检对标账号(排在 20:00 回采之后, 两个都用 ego lite 默认配置, 错开不抢页面)。
 * 与 collect-douyin 同样的规矩: 独立脚本直接写库; 失败写进日志并 exit 1, 首页读日志告警。
 */
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const analyzeDeps = await createAnalyzeDeps(db);
    const r = await runScan({
      store: createPrismaStore(db),
      client: createDouyinClient(),
      analyze: (id) => analyzeVideo(analyzeDeps, id),
      log,
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      now: () => new Date(),
      random: Math.random,
    });
    if (r.stopped || (r.accounts > 0 && r.failed === r.accounts)) process.exit(1);
  } catch (e) {
    log(`未预期的错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void main();
```

（注意：失败时 `runScan` 已写过具体原因；`r.accounts === 0` 时写"巡检完成: 账号 0 个…"属正常。）

`package.json` scripts 加 `"scan:benchmarks": "tsx scripts/scan-benchmarks.ts"`。

`scripts/com.mediapilot.scan-benchmarks.plist`：复制 `com.mediapilot.collect-douyin.plist`，改 Label 为 `com.mediapilot.scan-benchmarks`、`exec npm run scan:benchmarks`、`Minute` 为 `30`、日志路径 `logs/scan-benchmarks.log`，注释首行改为"每晚 20:30 巡检对标账号"。

`scripts/install-scan-cron.sh`：复制 `install-collect-cron.sh`，改 `LABEL="com.mediapilot.scan-benchmarks"`、提示文案（"每晚 20:30 对标巡检"、日志 `logs/scan-benchmarks.log`、`npm run scan:benchmarks`、`launchctl list | grep scan-benchmarks`）。

- [ ] **Step 7: 运行确认通过、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

```bash
git add src/lib/benchmark/scan.ts src/lib/douyin/collect-log.ts src/lib/health/checks.ts src/app/api/settings/health/route.ts src/app/page.tsx src/components/home/account-card.tsx src/lib/account/summary.ts scripts/scan-benchmarks.ts scripts/com.mediapilot.scan-benchmarks.plist scripts/install-scan-cron.sh package.json tests
git commit -m "feat(topics): 每晚对标巡检(限量/间隔/连续被拒即停) + 首页爆款入口与巡检告警 + 体检项

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 建项目、编导参考材料、照抄检查

**Files:**
- Create: `src/lib/benchmark/adopt.ts`、`src/lib/benchmark/copy-check.ts`
- Modify: `src/lib/agent/context.ts`、`src/lib/script/write.ts`、`src/lib/tools/write-script.ts`、`src/lib/tools/patch-script.ts`、`tests/helpers/fake-db.ts`
- Test: `tests/lib/benchmark/copy-check.test.ts`、`tests/lib/benchmark/adopt.test.ts`、`tests/lib/agent/context.test.ts`（加用例）、`tests/lib/tools/write-script.test.ts`（加用例）

**Interfaces:**
- Consumes: `VideoRow`、`Analysis`（Task 2/4）
- Produces（`copy-check.ts`）：`COPY_RUN = 12`；`findCopied(text: string, reference: string, run?: number): string[]`（返回被照抄的片段，去标点空白后比较，相邻窗口合并）
- Produces（`adopt.ts`）：
  - `interface Reference { author: string; ratio: number | null; transcript: string; analysis: Analysis | null }`
  - `loadReference(db: PrismaClient, benchmarkVideoId: string | null): Promise<Reference | null>`
  - `formatReference(r: Reference): string`
  - `createProjectFromVideo(db: PrismaClient, videoId: string, title?: string): Promise<{ id: string }>`
- Produces（`context.ts`）：`formatSystemPrompt` 参数加 `reference?: Reference | null`；有参考时输出「【参考的对标作品】」块，RULES 加照抄规则
- Produces（`write.ts`）：`writeScript` opts 加 `reference?: string`（拼进首条消息）
- Produces（工具）：`write_script` / `patch_script` 的 `data` 加 `copied: string[]`，有照抄时 summary 追加"，有 N 处照抄对标原句"
- Produces（`fake-db.ts`）：`FakeProject` 加 `benchmarkVideoId?: string | null`；`createFakeDb` seed 支持 `benchmarkVideo?: { id: string; transcript: string | null; analysis: unknown; ratio: number | null; account: { nickname: string } }`，`db.benchmarkVideo.findUnique({ where: { id }, include })` 返回它

- [ ] **Step 1: 写失败测试**

`tests/lib/benchmark/copy-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findCopied } from '@/lib/benchmark/copy-check';

const ref = '很多人对AI的印象还停留在聊天写代码的线上工具，但其实它早就已经悄悄走进了我们的生活';

describe('findCopied', () => {
  it('finds a run of 12+ identical characters, ignoring punctuation', () => {
    expect(findCopied('说实话，很多人对 AI 的印象还停留在聊天写代码！我不这么看', ref)).toEqual(['很多人对AI的印象还停留在聊天写代码']);
  });
  it('ignores short overlaps', () => {
    expect(findCopied('很多人对AI的印象不太好', ref)).toEqual([]);
  });
  it('returns nothing without a reference', () => {
    expect(findCopied('任何文字任何文字任何文字任何文字', '')).toEqual([]);
  });
});
```

`tests/lib/benchmark/adopt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatReference } from '@/lib/benchmark/adopt';

describe('formatReference', () => {
  it('lists author, ratio, analysis and transcript', () => {
    const t = formatReference({
      author: '园长说AI',
      ratio: 4.5,
      transcript: '很多人对AI的印象还停留在聊天写代码',
      analysis: { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签', fit: 'high', fitReason: '对上效率革命', myAngle: '讲你实测的工具' },
    });
    expect(t).toContain('博主：园长说AI（点赞是他平时的 4.5 倍）');
    expect(t).toContain('选题：AI 帮听障摊主做生意');
    expect(t).toContain('开头钩子（反常识）：很多人对AI的印象还停留在聊天写代码');
    expect(t).toContain('【逐字稿】\n很多人对AI的印象还停留在聊天写代码');
  });
});
```

`tests/lib/agent/context.test.ts` 追加：

```ts
  it('adds the benchmark reference block and the no-copy rule', () => {
    const p = formatSystemPrompt({
      title: 't', stage: 'draft', targetSec: 60, script: null, persona: null,
      reference: { author: '园长说AI', ratio: 4.5, transcript: '原话', analysis: null },
    });
    expect(p).toContain('【参考的对标作品】');
    expect(p).toContain('只借三样：选题、开头钩子的写法、标题思路');
    expect(p).toContain('copied');
  });
  it('omits the reference block when there is none', () => {
    expect(formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null })).not.toContain('【参考的对标作品】');
  });
```

`tests/lib/tools/write-script.test.ts` 追加：

```ts
  it('passes the benchmark reference to the writer and reports copied sentences', async () => {
    const firstMessages: string[] = [];
    const copyLlm: StructuredLLM = {
      callStructured: (async (o: { userMessage: { text: string }[] }) => {
        firstMessages.push(o.userMessage[0].text);
        return { result: { title: 't', segments: onBudget.map((n, i) => ({ role: 'x', text: i === 0 ? '很多人对AI的印象还停留在聊天写代码' : '字'.repeat(n) })) }, usage: {} };
      }) as unknown as StructuredLLM['callStructured'],
    };
    const { db } = createFakeDb({
      project: { benchmarkVideoId: 'bv1' },
      benchmarkVideo: { id: 'bv1', transcript: '很多人对AI的印象还停留在聊天写代码的线上工具', analysis: null, ratio: 3, account: { nickname: '园长说AI' } },
    });
    const r = await writeScriptTool.execute({ projectId: 'p1', db, llm: copyLlm }, { direction: '讲 AI 帮人' });
    expect(firstMessages[0]).toContain('【参考的对标作品】');
    expect((r.data as { copied: string[] }).copied).toEqual(['很多人对AI的印象还停留在聊天写代码']);
    expect(r.summary).toContain('有 1 处照抄对标原句');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/copy-check.test.ts tests/lib/benchmark/adopt.test.ts tests/lib/agent tests/lib/tools`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/benchmark/copy-check.ts`**

```ts
/** 与对标逐字稿连续 12 字以上相同 = 照抄。去掉标点和空白再比, 避免加个逗号就绕过。 */
export const COPY_RUN = 12;

const norm = (s: string) => Array.from(s.replace(/[\s\p{P}\p{S}]/gu, ''));

export function findCopied(text: string, reference: string, run = COPY_RUN): string[] {
  const t = norm(text);
  const ref = norm(reference).join('');
  if (!ref || t.length < run) return [];
  const hit = new Array<boolean>(t.length).fill(false);
  for (let i = 0; i + run <= t.length; i++) {
    if (ref.includes(t.slice(i, i + run).join(''))) for (let j = i; j < i + run; j++) hit[j] = true;
  }
  const out: string[] = [];
  let cur = '';
  hit.forEach((h, i) => {
    if (h) cur += t[i];
    else if (cur) {
      out.push(cur);
      cur = '';
    }
  });
  if (cur) out.push(cur);
  return out;
}
```

- [ ] **Step 4: 实现 `src/lib/benchmark/adopt.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { AnalysisSchema, type Analysis } from './analyze';

export interface Reference {
  author: string;
  ratio: number | null;
  transcript: string;
  analysis: Analysis | null;
}

export async function loadReference(db: PrismaClient, benchmarkVideoId: string | null): Promise<Reference | null> {
  if (!benchmarkVideoId) return null;
  const v = await db.benchmarkVideo.findUnique({ where: { id: benchmarkVideoId }, include: { account: true } });
  if (!v) return null;
  const a = AnalysisSchema.safeParse(v.analysis);
  return { author: v.account.nickname, ratio: v.ratio, transcript: v.transcript ?? '', analysis: a.success ? a.data : null };
}

export function formatReference(r: Reference): string {
  const lines = [`博主：${r.author}${r.ratio ? `（点赞是他平时的 ${r.ratio} 倍）` : ''}`];
  if (r.analysis) {
    lines.push(`选题：${r.analysis.topic}`, `开头钩子（${r.analysis.hook.type}）：${r.analysis.hook.quote}`, `标题写法：${r.analysis.titlePattern}`, `建议角度：${r.analysis.myAngle}`);
  }
  if (r.transcript) lines.push(`【逐字稿】\n${r.transcript}`);
  return lines.join('\n');
}

/** 从对标作品建项目: 标题用拆解的选题(没拆解用文案前 30 字), 记下参考作品, 作品标为已建项目 */
export async function createProjectFromVideo(db: PrismaClient, videoId: string, title?: string): Promise<{ id: string }> {
  const v = await db.benchmarkVideo.findUniqueOrThrow({ where: { id: videoId } });
  const a = AnalysisSchema.safeParse(v.analysis);
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const p = await db.project.create({
    data: {
      title: title?.trim() || (a.success ? a.data.topic : v.desc.replace(/#\S+/g, '').trim().slice(0, 30)) || '未命名项目',
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
      benchmarkVideoId: v.id,
    },
  });
  await db.benchmarkVideo.update({ where: { id: v.id }, data: { status: 'adopted' } });
  return { id: p.id };
}
```

- [ ] **Step 5: 编导上下文（`src/lib/agent/context.ts`）**

RULES 末尾（"回复用中文，简短。"之前）加一行：

```
- 有【参考的对标作品】时：只借三样：选题、开头钩子的写法、标题思路。不照抄原句，用用户的角度讲；工具返回 copied 非空时，用 patch_script 把这些句子换成用户自己的说法。
```

`formatSystemPrompt` 参数加 `reference?: Reference | null`，在 `【当前稿子】` 块之前插入 `p.reference ? `【参考的对标作品】\n${formatReference(p.reference)}` : ''`。`buildSystemPrompt` 里 `reference: await loadReference(db, p.benchmarkVideoId ?? null)`。import `formatReference, loadReference, type Reference` from `@/lib/benchmark/adopt`。

- [ ] **Step 6: 写稿带参考 + 照抄检查**

`src/lib/script/write.ts`：`writeScript` opts 加 `reference?: string`；`firstMessage` 加第四个参数 `reference = ''`，在【这条讲什么】之后拼：

```ts
${reference ? `\n\n【参考的对标作品】（只借选题、开头钩子的写法、标题思路；不得照抄原句，连续 12 字相同即算照抄）\n${reference}` : ''}
```

调用处传 `opts.reference`。

`src/lib/tools/write-script.ts`：在 `writeScript` 之前 `const ref = await loadReference(ctx.db, project.benchmarkVideoId ?? null);`，传 `reference: ref ? formatReference(ref) : undefined`；保存后 `const copied = ref ? findCopied(script.segments.map((s) => s.text).join('\n'), ref.transcript) : [];`；summary 末尾追加 `copied.length ? `，有 ${copied.length} 处照抄对标原句` : ''`；`data` 加 `copied`。

`src/lib/tools/patch-script.ts`：同样在返回前算 `copied`（对改后的整稿），summary 追加同样文案，`data` 加 `copied`。

`tests/helpers/fake-db.ts`：`FakeProject` 加 `benchmarkVideoId?: string | null`（默认 `null`）；seed 类型加 `benchmarkVideo?`；返回的 db 对象加：

```ts
    benchmarkVideo: {
      findUnique: async ({ where }: { where: { id: string } }) => (seed.benchmarkVideo && seed.benchmarkVideo.id === where.id ? { ...seed.benchmarkVideo } : null),
    },
```

- [ ] **Step 7: 运行确认通过、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

```bash
git add src/lib/benchmark src/lib/agent/context.ts src/lib/script/write.ts src/lib/tools tests
git commit -m "feat(topics): 从对标建项目 + 编导参考材料(只借选题/钩子/标题) + 照抄检查(连续 12 字)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 编导「找选题」

**Files:**
- Create: `src/lib/benchmark/suggest.ts`、`src/lib/tools/suggest-topics.ts`
- Modify: `src/lib/tools/index.ts`、`src/lib/tools/types.ts`（`ToolContext` 不改）、`src/lib/agent/context.ts`（RULES 一行）
- Test: `tests/lib/benchmark/suggest.test.ts`

**Interfaces:**
- Consumes: `BenchmarkStore`、`VideoRow`、`AnalysisSchema`
- Produces（`suggest.ts`）：
  - `SUGGEST_DAYS = 14`、`MIN_HITS = 2`
  - `interface TopicSuggestion { topic: string; why: string; hook: string; sources: { id: string; author: string; ratio: number | null; desc: string }[] }`
  - `suggestTopics(opts: { store: BenchmarkStore; llm: StructuredLLM; personaText: string; myTopTitles: string[]; now: Date }): Promise<{ ok: true; topics: TopicSuggestion[] } | { ok: false; reason: string }>`
  - `loadMyTopTitles(db: PrismaClient): Promise<string[]>`（公开作品点赞最高 5 条标题）
- Produces（工具）：`suggestTopicsTool: Tool<Record<string, never>>`，name `suggest_topics`，label `找选题`

- [ ] **Step 1: 写失败测试 `tests/lib/benchmark/suggest.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { suggestTopics } from '@/lib/benchmark/suggest';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-09-28T12:00:00Z');

async function storeWithHits(n: number) {
  const store = createMemoryStore();
  const acc = await store.upsertAccount({ secUid: 'MS4wA', nickname: '园长说AI', douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 }, { status: 'following', source: 'manual' });
  for (let i = 0; i < n; i++) {
    const v = await store.upsertVideo(acc.id, { awemeId: `7${i}00000000`, desc: `爆款${i}`, url: 'u', publishedAt: new Date(now.getTime() - (i + 1) * 86400_000), durationSec: 60, digg: 9000, comment: 0, collect: 0, share: 0, isTop: false, playUrls: [], authorSecUid: '', authorName: '' }, now);
    await store.updateVideo(v.id, { isHit: true, ratio: 4, hitAt: now });
  }
  return store;
}

describe('suggestTopics', () => {
  it('refuses without calling the model when there are fewer than 2 recent hits', async () => {
    const llm = { callStructured: vi.fn() } as unknown as StructuredLLM;
    const r = await suggestTopics({ store: await storeWithHits(1), llm, personaText: '', myTopTitles: [], now });
    expect(r).toEqual({ ok: false, reason: '近 14 天对标里只有 1 条爆款，数据太少挑不出靠谱的选题。先在「选题」页多关注几个对标账号，等巡检跑几晚再来。' });
    expect(llm.callStructured).not.toHaveBeenCalled();
  });
  it('drops topics whose sources are not in the input', async () => {
    const store = await storeWithHits(3);
    const ids = store.videos.map((v) => v.id);
    const llm = {
      callStructured: vi.fn(async () => ({
        result: {
          topics: [
            { topic: 'A', why: '对上效率革命', hook: '你还在手动…', sourceVideoIds: [ids[0]] },
            { topic: '编的热点', why: 'x', hook: 'y', sourceVideoIds: ['not-a-real-id'] },
            { topic: 'C', why: 'z', hook: 'w', sourceVideoIds: [ids[1], 'fake'] },
          ],
        },
        usage: {},
      })),
    } as unknown as StructuredLLM;
    const r = await suggestTopics({ store, llm, personaText: '支柱：效率革命', myTopTitles: ['我的爆款'], now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics.map((t) => t.topic)).toEqual(['A', 'C']);
    expect(r.topics[1].sources.map((s) => s.id)).toEqual([ids[1]]);
    expect(r.topics[0].sources[0]).toMatchObject({ author: '园长说AI', ratio: 4 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/suggest.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/benchmark/suggest.ts`**

```ts
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { StructuredLLM } from '@/lib/script/write';
import { AnalysisSchema } from './analyze';
import type { BenchmarkStore } from './store';

export const SUGGEST_DAYS = 14;
export const MIN_HITS = 2;

export interface TopicSuggestion {
  topic: string;
  why: string;
  hook: string;
  sources: { id: string; author: string; ratio: number | null; desc: string }[];
}

const OutSchema = z.object({
  topics: z.array(z.object({ topic: z.string().min(1), why: z.string().min(1), hook: z.string().min(1), sourceVideoIds: z.array(z.string()).min(1) })).min(1).max(3),
});

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，从最近的对标爆款里给博主挑 3 个能做的选题。
- 只能基于给你的对标爆款（每条有编号）；每个选题的 sourceVideoIds 填它参考的爆款编号，必须来自输入。
- 不编造"最近很火的XX"这类输入里没有的热点，不编数字。
- why：为什么适合这个博主（对上了定位里哪个内容支柱或痛点；可参考博主自己跑得好的作品）。
- hook：建议的开头钩子（一句话，借写法，不照抄对标原话）。
- 避开博主定位里的忌讳。
只输出 JSON：{"topics": [{"topic": "", "why": "", "hook": "", "sourceVideoIds": [""]}]}`;

export async function suggestTopics(opts: {
  store: BenchmarkStore;
  llm: StructuredLLM;
  personaText: string;
  myTopTitles: string[];
  now: Date;
}): Promise<{ ok: true; topics: TopicSuggestion[] } | { ok: false; reason: string }> {
  const hits = await opts.store.listVideos({ isHit: true, statusNot: ['ignored'], publishedSince: new Date(opts.now.getTime() - SUGGEST_DAYS * 86400_000) });
  if (hits.length < MIN_HITS) {
    return { ok: false, reason: `近 ${SUGGEST_DAYS} 天对标里只有 ${hits.length} 条爆款，数据太少挑不出靠谱的选题。先在「选题」页多关注几个对标账号，等巡检跑几晚再来。` };
  }
  const authors = new Map<string, string>();
  for (const h of hits) {
    if (!authors.has(h.accountId)) authors.set(h.accountId, (await opts.store.getAccount(h.accountId))?.nickname ?? '');
  }
  const list = hits
    .map((h) => {
      const a = AnalysisSchema.safeParse(h.analysis);
      const detail = a.success ? `选题：${a.data.topic}｜钩子（${a.data.hook.type}）：${a.data.hook.quote}` : `文案：${h.desc.slice(0, 80)}`;
      return `[${h.id}] ${authors.get(h.accountId)}｜平时的 ${h.ratio ?? '?'} 倍｜${detail}`;
    })
    .join('\n');
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      {
        type: 'text',
        text: `【博主定位】\n${opts.personaText || '（未填写）'}\n\n【博主自己跑得好的作品】\n${opts.myTopTitles.join('\n') || '（暂无）'}\n\n【近 ${SUGGEST_DAYS} 天对标爆款】\n${list}`,
      },
    ],
    responseSchema: OutSchema,
  });
  const byId = new Map(hits.map((h) => [h.id, h]));
  const topics = result.topics
    .map((t) => ({
      topic: t.topic,
      why: t.why,
      hook: t.hook,
      sources: t.sourceVideoIds.filter((id) => byId.has(id)).map((id) => {
        const h = byId.get(id)!;
        return { id, author: authors.get(h.accountId) ?? '', ratio: h.ratio, desc: h.desc };
      }),
    }))
    .filter((t) => t.sources.length > 0);
  if (topics.length === 0) return { ok: false, reason: '这次编导给的选题都对不上已有的对标作品，已丢弃。再点一次试试。' };
  return { ok: true, topics };
}

export async function loadMyTopTitles(db: PrismaClient): Promise<string[]> {
  const rows = await db.publishedWork.findMany({ where: { isPrivate: false }, orderBy: { digg: 'desc' }, take: 5, select: { title: true } });
  return rows.map((r) => r.title);
}
```

- [ ] **Step 4: 工具 `src/lib/tools/suggest-topics.ts`**

```ts
import { z } from 'zod';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { createPrismaStore } from '@/lib/benchmark/store';
import { formatPersona, type PersonaLike, type Tool } from './types';

const Input = z.object({});

export const suggestTopicsTool: Tool<z.infer<typeof Input>> = {
  name: 'suggest_topics',
  label: '找选题',
  description: '用户还没定这条讲什么、请你帮忙找选题时调用。从近 14 天的对标爆款里挑 3 个适合用户的选题。项目已有稿子时不要用。',
  input: Input,
  async execute(ctx) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    if (project.script) return { ok: false, summary: '找选题：这个项目已经有稿子了，找选题请新建项目或去「选题」页' };
    const r = await suggestTopics({
      store: createPrismaStore(ctx.db),
      llm: ctx.llm,
      personaText: formatPersona((project.personaSnapshot as PersonaLike | null) ?? null),
      myTopTitles: await loadMyTopTitles(ctx.db),
      now: new Date(),
    });
    if (!r.ok) return { ok: false, summary: `找选题：${r.reason}` };
    return {
      ok: true,
      summary: `找选题：${r.topics.length} 个`,
      data: { topics: r.topics.map((t) => ({ topic: t.topic, why: t.why, hook: t.hook, 参考: t.sources.map((s) => `${s.author}（平时的 ${s.ratio ?? '?'} 倍）：${s.desc.slice(0, 40)}`) })) },
    };
  },
};
```

`src/lib/tools/index.ts`：加入 `suggestTopicsTool`。`src/lib/agent/context.ts` RULES 加一行：`- 用户还没定选题、让你帮忙找时：调用 suggest_topics，把 3 个选题连同理由和参考的对标简短列给用户；用户选定后再 write_script。不要自己编热点。`

- [ ] **Step 5: 运行确认通过、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

```bash
git add src/lib/benchmark/suggest.ts src/lib/tools src/lib/agent/context.ts tests/lib/benchmark/suggest.test.ts
git commit -m "feat(topics): 编导找选题(只基于对标数据, 来源校验, 数据不足如实说明)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 选题接口

**Files:**
- Create: `src/lib/benchmark/view.ts`、`src/app/api/topics/videos/route.ts`、`src/app/api/topics/videos/[id]/route.ts`、`src/app/api/topics/videos/[id]/analyze/route.ts`、`src/app/api/topics/videos/[id]/project/route.ts`、`src/app/api/topics/link/route.ts`、`src/app/api/topics/accounts/route.ts`、`src/app/api/topics/accounts/[id]/route.ts`、`src/app/api/topics/accounts/search/route.ts`、`src/app/api/topics/suggest/route.ts`
- Test: `tests/lib/benchmark/view.test.ts`

**Interfaces:**
- Produces（`view.ts`）：
  - `interface VideoView { id: string; author: string; publishedAt: string; desc: string; url: string; digg: number; comment: number; collect: number; share: number; ratio: number | null; isHit: boolean; status: string; analysisStatus: 'none' | 'running' | 'done' | 'failed'; analysisError: string | null; transcript: string | null; analysis: Analysis | null }`
  - `interface AccountView { id: string; nickname: string; douyinId: string; avatarUrl: string; bio: string; followers: number; baselineDigg: number | null; status: string; lastCheckedAt: string | null; lastHitAt: string | null }`
  - `toVideoView(v: VideoRow, author: string, active: boolean): VideoView`（`analysisStatus === 'running'` 且队列里没有 → 视为 `failed`，`analysisError = '拆解被服务重启打断了，点重试。'`）
  - `staleRunning(v: VideoRow, active: boolean): boolean`
- HTTP（全部 `{ success, data?, message? }`）：
  - `GET /api/topics/videos?filter=hits|all` → `VideoView[]`（`hits`：`isHit` 且未忽略；`all`：近 30 天未忽略；各最多 100 条）。把 stale running 写回库为 failed。
  - `PATCH /api/topics/videos/[id]` body `{ status: 'seen' | 'ignored' }`
  - `POST /api/topics/videos/[id]/analyze` → `{ queued: boolean }`（置 running 并入队）
  - `POST /api/topics/videos/[id]/project` body `{ title?: string }` → `{ projectId }`
  - `POST /api/topics/link` body `{ text }` → `{ kind: 'video'; videoId } | { kind: 'account'; accountId }`
  - `GET /api/topics/accounts` → `{ following: AccountView[]; candidates: AccountView[] }`
  - `POST /api/topics/accounts/search` body `{ keyword }` → `AccountView[]`（新账号记为 candidate/source search；超限额 429 "今天搜索次数用完了（每天 10 次，保护账号）"）
  - `PATCH /api/topics/accounts/[id]` body `{ status: 'following' | 'candidate' | 'ignored' }`
  - `POST /api/topics/suggest` → `TopicSuggestion[]` 或 400 带 reason

- [ ] **Step 1: 写失败测试 `tests/lib/benchmark/view.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { toVideoView, staleRunning } from '@/lib/benchmark/view';
import type { VideoRow } from '@/lib/benchmark/store';

const row: VideoRow = {
  id: 'v1', awemeId: '7', accountId: 'a1', desc: 'd', url: 'u', publishedAt: new Date('2026-09-20T00:00:00Z'), durationSec: 60,
  digg: 9000, comment: 1, collect: 2, share: 3, ratio: 4.5, isHit: true, hitAt: null, status: 'new',
  analysisStatus: 'running', analysisError: null, transcript: null, analysis: { bad: true }, analyzedAt: null, fetchedAt: new Date(),
};

describe('toVideoView', () => {
  it('marks a stale running analysis as failed', () => {
    expect(staleRunning(row, false)).toBe(true);
    expect(toVideoView(row, '园长说AI', false)).toMatchObject({ analysisStatus: 'failed', analysisError: '拆解被服务重启打断了，点重试。' });
  });
  it('keeps running while the queue has it, and drops invalid analysis', () => {
    const v = toVideoView(row, '园长说AI', true);
    expect(v).toMatchObject({ analysisStatus: 'running', author: '园长说AI', publishedAt: '2026-09-20T00:00:00.000Z' });
    expect(v.analysis).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/benchmark/view.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/benchmark/view.ts`**

```ts
import { AnalysisSchema, type Analysis } from './analyze';
import type { AccountRow, VideoRow } from './store';

export interface VideoView {
  id: string;
  author: string;
  publishedAt: string;
  desc: string;
  url: string;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  ratio: number | null;
  isHit: boolean;
  status: string;
  analysisStatus: 'none' | 'running' | 'done' | 'failed';
  analysisError: string | null;
  transcript: string | null;
  analysis: Analysis | null;
}

export interface AccountView {
  id: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  baselineDigg: number | null;
  status: string;
  lastCheckedAt: string | null;
  lastHitAt: string | null;
}

export const STALE_MESSAGE = '拆解被服务重启打断了，点重试。';

export function staleRunning(v: VideoRow, active: boolean): boolean {
  return v.analysisStatus === 'running' && !active;
}

export function toVideoView(v: VideoRow, author: string, active: boolean): VideoView {
  const stale = staleRunning(v, active);
  const a = AnalysisSchema.safeParse(v.analysis);
  return {
    id: v.id,
    author,
    publishedAt: v.publishedAt.toISOString(),
    desc: v.desc,
    url: v.url,
    digg: v.digg,
    comment: v.comment,
    collect: v.collect,
    share: v.share,
    ratio: v.ratio,
    isHit: v.isHit,
    status: v.status,
    analysisStatus: stale ? 'failed' : (v.analysisStatus as VideoView['analysisStatus']),
    analysisError: stale ? STALE_MESSAGE : v.analysisError,
    transcript: v.transcript,
    analysis: a.success ? a.data : null,
  };
}

export function toAccountView(a: AccountRow, lastHitAt: Date | null): AccountView {
  return {
    id: a.id,
    nickname: a.nickname,
    douyinId: a.douyinId,
    avatarUrl: a.avatarUrl,
    bio: a.bio,
    followers: a.followers,
    baselineDigg: a.baselineDigg,
    status: a.status,
    lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
    lastHitAt: lastHitAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: 接口**

`src/app/api/topics/videos/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { createPrismaStore } from '@/lib/benchmark/store';
import { isAnalysisActive } from '@/lib/benchmark/queue';
import { staleRunning, toVideoView, STALE_MESSAGE } from '@/lib/benchmark/view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const filter = new URL(req.url).searchParams.get('filter') === 'all' ? 'all' : 'hits';
  const store = createPrismaStore(prisma);
  const rows = await store.listVideos(
    filter === 'hits'
      ? { isHit: true, statusNot: ['ignored'], take: 100 }
      : { statusNot: ['ignored'], publishedSince: new Date(Date.now() - 30 * 86400_000), take: 100 },
  );
  const names = new Map((await store.listAccounts()).map((a) => [a.id, a.nickname]));
  for (const r of rows) {
    if (staleRunning(r, isAnalysisActive(r.id))) await store.updateVideo(r.id, { analysisStatus: 'failed', analysisError: STALE_MESSAGE });
  }
  return ok(rows.map((r) => toVideoView(r, names.get(r.accountId) ?? '', isAnalysisActive(r.id))));
}
```

`src/app/api/topics/videos/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (status !== 'seen' && status !== 'ignored') return fail('只能标记为已看或忽略', 400);
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  // 已建项目的作品不因为"看过"而降级
  if (!(status === 'seen' && v.status === 'adopted')) await prisma.benchmarkVideo.update({ where: { id: v.id }, data: { status } });
  return ok({ status });
}
```

`src/app/api/topics/videos/[id]/analyze/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { enqueueAnalysis } from '@/lib/benchmark/queue';
import { analyzeVideo } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  const queued = enqueueAnalysis(v.id, async (id) => analyzeVideo(await createAnalyzeDeps(prisma), id));
  if (queued) await prisma.benchmarkVideo.update({ where: { id: v.id }, data: { analysisStatus: 'running', analysisError: null } });
  return ok({ queued });
}
```

`src/app/api/topics/videos/[id]/project/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createProjectFromVideo } from '@/lib/benchmark/adopt';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  const p = await createProjectFromVideo(prisma, v.id, typeof title === 'string' ? title : undefined);
  return ok({ projectId: p.id });
}
```

`src/app/api/topics/link/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveLink } from '@/lib/benchmark/link';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { applyAccountWorks } from '@/lib/benchmark/scan';
import { enqueueAnalysis } from '@/lib/benchmark/queue';
import { analyzeVideo, explainAnalyzeError } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const target = typeof text === 'string' ? await resolveLink(text).catch(() => null) : null;
  if (!target) return fail('这不是抖音视频或主页链接。在抖音里点「分享 → 复制链接」再粘贴。', 400);
  const client = createDouyinClient();
  const store = createPrismaStore(prisma);
  try {
    if (target.kind === 'user') {
      const { profile, works } = await client.fetchAccount(target.secUid);
      const acc = await store.upsertAccount(profile, { status: 'following', source: 'manual' });
      if (acc.status !== 'following') await store.updateAccount(acc.id, { status: 'following' });
      await applyAccountWorks(store, { ...acc, status: 'following' }, profile, works, new Date());
      return ok({ kind: 'account' as const, accountId: acc.id });
    }
    const w = await client.fetchDetail(target.awemeId);
    const acc = await store.upsertAccount(
      { secUid: w.authorSecUid, nickname: w.authorName, douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 },
      { status: 'candidate', source: 'link' },
    );
    const v = await store.upsertVideo(acc.id, w, new Date());
    if (enqueueAnalysis(v.id, async (id) => analyzeVideo(await createAnalyzeDeps(prisma), id))) {
      await store.updateVideo(v.id, { analysisStatus: 'running', analysisError: null });
    }
    return ok({ kind: 'video' as const, videoId: v.id });
  } catch (e) {
    return fail(explainAnalyzeError(e), 502);
  }
}
```

（注意：`upsertAccount` 对已存在账号不改资料以外的字段；粘作品链接顺带建的账号只有名字，这是预期——关注它后首次巡检会补全资料。粘作品链接的作品不在"只看爆款"里，切到"全部"可见；界面在粘贴成功后自动切到"全部"并滚到这条。）

`src/app/api/topics/accounts/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { createPrismaStore } from '@/lib/benchmark/store';
import { toAccountView } from '@/lib/benchmark/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = createPrismaStore(prisma);
  const all = await store.listAccounts();
  const lastHits = await prisma.benchmarkVideo.groupBy({ by: ['accountId'], where: { hitAt: { not: null } }, _max: { hitAt: true } });
  const hitMap = new Map(lastHits.map((h) => [h.accountId, h._max.hitAt]));
  const view = (status: string) => all.filter((a) => a.status === status).map((a) => toAccountView(a, hitMap.get(a.id) ?? null));
  return ok({ following: view('following'), candidates: view('candidate') });
}
```

`src/app/api/topics/accounts/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!['following', 'candidate', 'ignored'].includes(status ?? '')) return fail('状态不对', 400);
  const a = await prisma.benchmarkAccount.findUnique({ where: { id: params.id } });
  if (!a) return fail('找不到这个账号', 404);
  await prisma.benchmarkAccount.update({ where: { id: a.id }, data: { status } });
  return ok({ status });
}
```

`src/app/api/topics/accounts/search/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { takeSearchQuota, SEARCH_DAILY_LIMIT } from '@/lib/benchmark/quota';
import { toAccountView } from '@/lib/benchmark/view';
import { explainAnalyzeError } from '@/lib/benchmark/analyze';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { keyword } = (await req.json().catch(() => ({}))) as { keyword?: string };
  const kw = typeof keyword === 'string' ? keyword.trim() : '';
  if (!kw || kw.length > 20) return fail('输入一个关键词（20 字以内），如「AI工具」', 400);
  if (!(await takeSearchQuota())) return fail(`今天搜索次数用完了（每天 ${SEARCH_DAILY_LIMIT} 次，保护账号），明天再搜。`, 429);
  try {
    const found = await createDouyinClient().searchUsers(kw);
    const store = createPrismaStore(prisma);
    const rows = [];
    for (const p of found) rows.push(await store.upsertAccount(p, { status: 'candidate', source: 'search', searchKeyword: kw }));
    return ok(rows.map((a) => toAccountView(a, null)));
  } catch (e) {
    return fail(explainAnalyzeError(e), 502);
  }
}
```

`src/app/api/topics/suggest/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { createPrismaStore } from '@/lib/benchmark/store';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  const key = getDeepSeekKey();
  if (!key) return fail('没有配置 DeepSeek key：去设置页填入后再试。', 400);
  const persona = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  try {
    const r = await suggestTopics({
      store: createPrismaStore(prisma),
      llm: new DeepSeekTextLLM({ apiKey: key }),
      personaText: formatPersona(persona as PersonaLike | null),
      myTopTitles: await loadMyTopTitles(prisma),
      now: new Date(),
    });
    return r.ok ? ok(r.topics) : fail(r.reason, 400);
  } catch {
    return fail('编导这次没挑出来（DeepSeek 没按格式回答），再点一次。', 502);
  }
}
```

- [ ] **Step 5: 运行确认通过、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

```bash
git add src/lib/benchmark/view.ts src/app/api/topics tests/lib/benchmark/view.test.ts
git commit -m "feat(topics): 选题接口(作品/拆解/建项目/粘链接/账号/搜博主/找选题), 重启打断的拆解显示为失败

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 选题页

**Files:**
- Create: `src/app/topics/page.tsx`、`src/components/topics/nav.ts`、`src/components/topics/topics-view.tsx`、`src/components/topics/video-card.tsx`、`src/components/topics/account-panel.tsx`、`src/components/topics/suggest-panel.tsx`
- Modify: `src/app/layout.tsx`（侧栏加「选题」，在「项目」之后）
- Test: `tests/components/topics/video-card.test.tsx`

**Interfaces:**
- Consumes: `VideoView`、`AccountView`、`TopicSuggestion`（Task 7/8）与 Task 8 的全部接口
- Produces: `VideoCard({ video, onChanged }: { video: VideoView; onChanged: () => void })`；`TopicsView()`（客户端，自取数）

- [ ] **Step 1: 写失败测试 `tests/components/topics/video-card.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoCard } from '@/components/topics/video-card';
import { goTo } from '@/components/topics/nav';
import type { VideoView } from '@/lib/benchmark/view';

vi.mock('@/components/topics/nav', () => ({ goTo: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: VideoView = {
  id: 'v1', author: '园长说AI', publishedAt: '2026-09-20T00:00:00.000Z', desc: '画面都交给AI了 #AI音乐', url: 'https://www.douyin.com/video/1',
  digg: 23417, comment: 10, collect: 20, share: 30, ratio: 4.5, isHit: true, status: 'new',
  analysisStatus: 'done', analysisError: null, transcript: '很多人对AI的印象还停留在聊天写代码',
  analysis: { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签', fit: 'high', fitReason: '对上效率革命', myAngle: '讲你实测的工具' },
};

describe('VideoCard', () => {
  it('shows likes as a multiple of the usual, topic, hook and fit', () => {
    render(<VideoCard video={base} onChanged={() => {}} />);
    expect(screen.getByText('23,417 赞 · 平时的 4.5 倍')).toBeTruthy();
    expect(screen.getByText('AI 帮听障摊主做生意')).toBeTruthy();
    expect(screen.getByText('契合度高')).toBeTruthy();
    expect(screen.queryByText(/播放/)).toBeNull();
  });
  it('shows the failure reason with a retry button', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, data: { queued: true } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<VideoCard video={{ ...base, analysisStatus: 'failed', analysisError: '下载视频时 ego lite 没有响应：打开 ego lite 重新登录一次，再点重试。', analysis: null }} onChanged={onChanged} />);
    expect(screen.getByText(/打开 ego lite 重新登录/)).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/topics/videos/v1/analyze');
  });
  it('creates a project and navigates to it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { projectId: 'p9' } }) })));
    render(<VideoCard video={base} onChanged={() => {}} />);
    fireEvent.click(screen.getByText('建项目'));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith('/projects/p9'));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/topics`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: `src/components/topics/nav.ts` 与 `src/components/topics/video-card.tsx`**

`src/components/topics/nav.ts`（整页跳转单独成模块，测试里 mock 它）:

```ts
export function goTo(url: string): void {
  window.location.assign(url);
}
```

`src/components/topics/video-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { VideoView } from '@/lib/benchmark/view';
import { goTo } from './nav';

const n = (v: number) => v.toLocaleString('en-US');
const FIT: Record<string, string> = { high: '契合度高', mid: '契合度中', low: '契合度低' };
const FIT_COLOR: Record<string, string> = { high: 'text-[var(--success)]', mid: 'text-[var(--warning)]', low: 'text-[var(--text-tertiary)]' };

async function post(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function VideoCard({ video: v, onChanged }: { video: VideoView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = v.analysis;

  const act = async (fn: () => Promise<{ success: boolean; message?: string; data?: unknown }>, after?: (d: unknown) => void) => {
    setBusy(true);
    setErr(null);
    const j = await fn();
    setBusy(false);
    if (!j.success) return setErr(j.message ?? '操作失败');
    after?.(j.data);
    onChanged();
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && v.status === 'new') void post(`/api/topics/videos/${v.id}`, { status: 'seen' }, 'PATCH');
  };

  return (
    <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">{v.author}</span>
        <span>{new Date(v.publishedAt).toLocaleDateString('zh-CN')}</span>
        <span className="font-mono">{`${n(v.digg)} 赞${v.ratio ? ` · 平时的 ${v.ratio} 倍` : ''}`}</span>
        {v.status === 'adopted' && <span className="text-[var(--accent)]">已建项目</span>}
      </div>
      {a ? (
        <>
          <h3 className="mt-2 text-base font-semibold">{a.topic}</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            <span className="text-[var(--text-tertiary)]">钩子（{a.hook.type}）：</span>
            {a.hook.quote}
          </p>
          <p className={`mt-1 text-xs ${FIT_COLOR[a.fit]}`}>
            <span>{FIT[a.fit]}</span>
            <span className="text-[var(--text-tertiary)]"> · {a.fitReason}</span>
          </p>
        </>
      ) : (
        <p className="mt-2 line-clamp-2 text-sm">{v.desc}</p>
      )}

      {v.analysisStatus === 'running' && <p className="mt-2 text-xs text-[var(--text-secondary)]">拆解中（下载、转写、分析，约 1 分钟）…</p>}
      {v.analysisStatus === 'failed' && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          {v.analysisError}{' '}
          <button className="underline" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}/analyze`))}>
            重试
          </button>
        </p>
      )}

      {open && a && (
        <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3 text-sm">
          <p><span className="text-[var(--text-tertiary)]">标题写法：</span>{a.titlePattern}</p>
          <p><span className="text-[var(--text-tertiary)]">你可以这么讲：</span>{a.myAngle}</p>
          <p className="text-[var(--text-tertiary)]">原文案：{v.desc}</p>
          {v.transcript && <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--bg-inset)] p-3 text-xs">{v.transcript}</pre>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {a && <button className="text-[var(--accent)]" onClick={toggle}>{open ? '收起' : '看拆解'}</button>}
        {v.analysisStatus === 'none' && (
          <button className="text-[var(--accent)]" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}/analyze`))}>
            拆解
          </button>
        )}
        <button
          className="text-[var(--accent)]"
          disabled={busy}
          onClick={() => void act(() => post(`/api/topics/videos/${v.id}/project`, {}), (d) => goTo(`/projects/${(d as { projectId: string }).projectId}`))}
        >
          建项目
        </button>
        <a className="text-[var(--text-secondary)]" href={v.url} target="_blank" rel="noreferrer">原视频</a>
        <button className="text-[var(--text-tertiary)]" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}`, { status: 'ignored' }, 'PATCH'))}>
          忽略
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-[var(--danger)]">{err}</p>}
    </article>
  );
}
```

- [ ] **Step 4: `src/components/topics/account-panel.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccountView } from '@/lib/benchmark/view';

const n = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v));

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

function Row({ a, action }: { a: AccountView; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-inset)]" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{a.nickname}</div>
        <div className="truncate text-xs text-[var(--text-tertiary)]">
          {a.followers ? `${n(a.followers)} 粉丝` : '资料待首次巡检'}
          {a.status === 'candidate' && a.bio ? ` · ${a.bio.slice(0, 30)}` : ''}
          {a.baselineDigg ? ` · 平时约 ${n(a.baselineDigg)} 赞` : ''}
          {a.lastHitAt ? ` · 最近爆款 ${new Date(a.lastHitAt).toLocaleDateString('zh-CN')}` : ''}
          {a.lastCheckedAt ? ` · 上次巡检 ${new Date(a.lastCheckedAt).toLocaleDateString('zh-CN')}` : ''}
        </div>
      </div>
      {action}
    </li>
  );
}

export function AccountPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ following: AccountView[]; candidates: AccountView[] } | null>(null);
  const [kw, setKw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const j = await call('/api/topics/accounts', 'GET');
    if (j.success) setData(j.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    const j = await call(`/api/topics/accounts/${id}`, 'PATCH', { status });
    if (!j.success) setMsg(j.message);
    await load();
    onChanged();
  };
  const search = async () => {
    setBusy(true);
    setMsg(null);
    const j = await call('/api/topics/accounts/search', 'POST', { keyword: kw });
    setBusy(false);
    if (!j.success) return setMsg(j.message);
    setMsg(j.data.length ? null : '没搜到博主，换个词试试。');
    await load();
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h2 className="mb-2 text-sm font-medium">对标账号（关注中 {data?.following.length ?? 0} 个，每晚 20:30 巡检）</h2>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {data?.following.map((a) => (
          <Row key={a.id} a={a} action={<button className="shrink-0 text-xs text-[var(--text-tertiary)]" onClick={() => void setStatus(a.id, 'candidate')}>取消关注</button>} />
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="按关键词搜博主，如：AI工具" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
        <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3 text-sm" disabled={busy || !kw.trim()} onClick={() => void search()}>
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">用你的大号只读搜索，每天最多 10 次。也可以在上方粘贴博主主页链接直接关注。</p>
      {msg && <p className="mt-2 text-xs text-[var(--danger)]">{msg}</p>}
      {data && data.candidates.length > 0 && (
        <>
          <h3 className="mt-4 text-xs text-[var(--text-secondary)]">候选（点关注才会加入巡检）</h3>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.candidates.map((a) => (
              <Row
                key={a.id}
                a={a}
                action={
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button className="text-[var(--accent)]" onClick={() => void setStatus(a.id, 'following')}>关注</button>
                    <button className="text-[var(--text-tertiary)]" onClick={() => void setStatus(a.id, 'ignored')}>不要</button>
                  </span>
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: `src/components/topics/suggest-panel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { TopicSuggestion } from '@/lib/benchmark/suggest';
import { goTo } from './nav';

export function SuggestPanel() {
  const [topics, setTopics] = useState<TopicSuggestion[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/topics/suggest', { method: 'POST' });
    const j = await res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
    setBusy(false);
    if (!j.success) return setMsg(j.message);
    setTopics(j.data);
  };
  const adopt = async (t: TopicSuggestion) => {
    const res = await fetch(`/api/topics/videos/${t.sources[0].id}/project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t.topic }) });
    const j = await res.json().catch(() => ({ success: false }));
    if (j.success) goTo(`/projects/${j.data.projectId}`);
    else setMsg(j.message ?? '建项目失败');
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center gap-3">
        <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]" disabled={busy} onClick={() => void run()}>
          {busy ? '编导在挑…' : '让编导挑 3 个'}
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">从近 14 天的对标爆款里，按你的定位挑</span>
      </div>
      {msg && <p className="mt-2 text-sm text-[var(--warning)]">{msg}</p>}
      {topics && (
        <ol className="mt-3 space-y-3">
          {topics.map((t, i) => (
            <li key={i} className="rounded-md bg-[var(--bg-inset)] p-3 text-sm">
              <div className="font-medium">{t.topic}</div>
              <p className="mt-1 text-[var(--text-secondary)]">{t.why}</p>
              <p className="mt-1 text-[var(--text-secondary)]"><span className="text-[var(--text-tertiary)]">开头可以这么说：</span>{t.hook}</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">参考：{t.sources.map((s) => `${s.author}（平时的 ${s.ratio ?? '?'} 倍）`).join('、')}</p>
              <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => void adopt(t)}>建项目</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `src/components/topics/topics-view.tsx` 与页面**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VideoView } from '@/lib/benchmark/view';
import { VideoCard } from './video-card';
import { AccountPanel } from './account-panel';
import { SuggestPanel } from './suggest-panel';

export function TopicsView() {
  const [filter, setFilter] = useState<'hits' | 'all'>('hits');
  const [videos, setVideos] = useState<VideoView[] | null>(null);
  const [link, setLink] = useState('');
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/topics/videos?filter=${filter}`);
    const j = await res.json().catch(() => ({ success: false }));
    setVideos(j.success ? j.data : []);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  // 有拆解在跑时每 3 秒刷新
  useEffect(() => {
    if (!videos?.some((v) => v.analysisStatus === 'running')) return;
    const t = setTimeout(() => void load(), 3000);
    return () => clearTimeout(t);
  }, [videos, load]);

  const paste = async () => {
    setLinkBusy(true);
    setLinkMsg(null);
    const res = await fetch('/api/topics/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: link }) });
    const j = await res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
    setLinkBusy(false);
    if (!j.success) return setLinkMsg({ ok: false, text: j.message });
    setLink('');
    setLinkMsg({ ok: true, text: j.data.kind === 'video' ? '已加入，正在拆解（在「全部」里）' : '已关注这个博主' });
    if (j.data.kind === 'video') setFilter('all');
    await load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <SuggestPanel />
        <div className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="粘贴抖音分享链接（视频或博主主页）" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3 text-sm" disabled={linkBusy || !link.trim()} onClick={() => void paste()}>
            {linkBusy ? '读取中…' : '加入'}
          </button>
        </div>
        {linkMsg && <p className={`text-xs ${linkMsg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{linkMsg.text}</p>}
        <div className="flex gap-4 text-sm">
          {(['hits', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'} onClick={() => setFilter(f)}>
              {f === 'hits' ? '只看爆款' : '全部新作品（30 天）'}
            </button>
          ))}
        </div>
        {videos === null ? (
          <p className="text-sm text-[var(--text-secondary)]">加载中…</p>
        ) : videos.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            {filter === 'hits' ? '还没有对标爆款。先在右侧关注几个对标账号，每晚 20:30 巡检后这里会出现。' : '近 30 天没有对标作品。'}
          </p>
        ) : (
          <div className="space-y-3">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} onChanged={() => void load()} />
            ))}
          </div>
        )}
      </div>
      <AccountPanel onChanged={() => void load()} />
    </div>
  );
}
```

`src/app/topics/page.tsx`:

```tsx
import { TopicsView } from '@/components/topics/topics-view';

export const dynamic = 'force-dynamic';

export default function TopicsPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">选题</h1>
      <TopicsView />
    </div>
  );
}
```

`src/app/layout.tsx`：侧栏数组在 `{ href: '/', label: '项目' }` 之后加 `{ href: '/topics', label: '选题' }`。

- [ ] **Step 7: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

真机（重启 dev：改了 schema、加了 API 目录）：打开 `/topics`，读 DOM 确认：侧栏有「选题」；空态文案正确；右侧账号面板可搜"AI工具"（消耗 1 次限额）→ 候选出现 → 关注 1 个 → 进关注列表；窄屏（<1024px）右栏落到下方、无横向滚动。

```bash
git add src/app/topics src/components/topics src/app/layout.tsx tests/components/topics
git commit -m "feat(topics): 选题页(对标爆款卡片/拆解/建项目/粘链接/对标账号/让编导挑 3 个)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-28-topic-radar-design.md`（§3 追加实测）

- [ ] **Step 1: README**

「现在能做什么」追加：

```markdown
- **选题**：关注对标博主（粘主页链接，或按关键词搜），每晚 20:30 用 ego lite 里登录的账号只读巡检，按"点赞是他平时的 3 倍以上"挑出爆款并自动拆解（逐字稿 + 选题 / 开头钩子 / 标题写法 / 与你定位的契合度）；一键建项目，编导写稿时借选题、钩子写法、标题思路，不照抄原句（连续 12 字相同会被标出来）。「让编导挑 3 个」从近 14 天的对标爆款里按你的定位出选题。也可以直接粘贴抖音分享链接拆解单条视频。
```

「每晚回采抖音数据」一节后加「每晚对标巡检」：安装 `sh scripts/install-scan-cron.sh`、手动 `npm run scan:benchmarks`、日志 `logs/scan-benchmarks.log`、风控护栏（每晚 ≤15 个账号、间隔 5～10 秒、连续 3 个被拒即停、搜索每天 ≤10 次、只读）。目录一节加 `src/lib/benchmark/  选题：抖音只读访问、巡检、拆解、找选题`。

- [ ] **Step 2: 真机验收（逐项，读 DOM / 日志核对）**

1. `/topics` 搜"AI工具"，关注 3 个博主。
2. `npm run scan:benchmarks`：日志出现「开始巡检」…「巡检完成: 账号 3 个…」；库里账号有 `baselineDigg`；若有爆款则自动拆解（≤5）。
3. 选一条作品手动「拆解」：约 1 分钟内出现选题/钩子/契合度；`/tmp` 下没有 `bm-*.mp4` 残留。
4. 「建项目」→ 跳到项目页；对编导说"按这个选题写一版"→ 写稿成功，若有照抄提示则按提示修掉。
5. 「让编导挑 3 个」：出 3 个（或数据不足的说明）；每个的参考来源可对上列表中的作品。
6. 粘贴一条抖音分享链接（请用户提供一条真实 `v.douyin.com` 短链）→ 拆解完成。
7. 首页显示"今天对标里有 N 条爆款 →"；设置页体检出现「对标巡检」项。

实测数据（耗时、爆款条数、拆解耗时）写入 spec §3 末尾。

- [ ] **Step 3: 收尾检查与提交**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git status --short
git add README.md docs/superpowers/specs/2026-09-28-topic-radar-design.md
git commit -m "docs: README 补选题模块与每晚对标巡检, spec 记录真机实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 全绿；`git status` 干净（`prisma/dev.db` 除外）。

安装定时任务（`sh scripts/install-scan-cron.sh`）属于改动用户系统的操作：验收通过后**先问用户**再装。
