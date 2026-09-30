# 视频制作三模式（十九期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-08-22-video-production-modes-design.md` 落地三种视频交付方式：①PPT 读稿（十五期已做，改名复用）②口播视频+B-roll 切探+动画字幕③插画+TTS 配音。

**Architecture:** 十五期的 Director/Builder/无头渲染三段代码原样复用于全部三种模式；新增一个"对齐"AI 阶段（DeepSeek 语义匹配真实语音到六幕边界）供②③共用其产出形状；新增 ffmpeg 挖空替换/字幕烧录/音轨混流三个函数；新增火山引擎 TTS 客户端 + 加密配置表；worker 按新的 `mode` 字段三路分岔。

**Tech Stack:** Next.js / TypeScript / Prisma / BullMQ / Playwright(headless Chromium) / ffmpeg / DeepSeek(`deepseek-reasoner`) / 火山引擎语音合成 API。

## Global Constraints

- 十五期已上线的 Director(`director-prompt.ts`)/Builder(`builder-prompt.ts`，除 Task 9 明确要加的 `visualStyle` 参数外)/渲染(`shot-renderer.ts`)三处代码逻辑不改，扩展参数必须带默认值保证①现状零回归。
- `VideoProduction.mode`（新字段，三种交付方式：`ppt-narration`/`talking-head-broll`/`illustration-tts`）与 `video-production-worker.ts` 现有的 `JobData.mode`（`preview`/`master`，预览档/正式档）是两个不同概念的同名字段——写代码/取变量名时必须清楚区分，不要混用（Task 8 起两者会同时出现在同一个函数里）。
- 数据库 schema 变更用 `npx prisma db push`（本项目没有 `prisma/migrations/` 目录，不用 `prisma migrate dev`）。
- 每个 Task 结束后 `npm run typecheck && npm run test` 全绿再 commit；尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- `'ai-faceless'` 改名为 `'ppt-narration'` 是一次全仓库字面量替换，涉及 `model.ts`/`platform-stages.ts`/`content-detail.tsx`/`stage-stepper.tsx`/`tests/lib/cockpit/platform-stages.test.ts` 五个文件，Task 1 一次性做完，后续任务不再触碰这条改名。
- 新增的火山 TTS access token 必须用 `src/lib/crypto.ts` 的 `encrypt()`/`decrypt()` 加密存储，API 响应只回掩码，不回明文——同 `AIConfig.apiKey` 现有规范。
- 涉及真实外部服务（火山 TTS API）或真实系统调用（ffmpeg 挖空替换/字幕烧录）的任务，验证方式是真实调用产出真实文件断言，不允许只 mock 通过——沿用 `shot-renderer.test.ts` 的"真实系统测试"先例。

---

### Task 1: `DeliveryMode` 类型收敛 + `ai-faceless` 改名 + `talking-head-broll` 阶段流

**Files:**
- Modify: `src/lib/cockpit/model.ts`（新增 `export type DeliveryMode`，`ContentItem.deliveryMode` 字段类型改用它）
- Modify: `src/lib/cockpit/platform-stages.ts`（6 处 `'manual' | 'ai-faceless'` 字面量改用 `DeliveryMode`，`stageFlowFor` 加 `talking-head-broll` 分支）
- Modify: `src/components/cockpit/content-detail.tsx`（5 处字面量，仅类型引用改动，暂不改 UI 结构——UI 结构改动在 Task 10）
- Modify: `src/components/cockpit/stage-stepper.tsx`（2 处字面量）
- Modify: `tests/lib/cockpit/platform-stages.test.ts`（7 处断言字符串改名）

**Interfaces (Produces，后续所有 Task 消费):**
```ts
// src/lib/cockpit/model.ts，紧挨 ContentItem 定义之前新增
export type DeliveryMode = 'manual' | 'ppt-narration' | 'talking-head-broll' | 'illustration-tts';

// ContentItem 里原 `deliveryMode?: 'manual' | 'ai-faceless';`（第 126 行）改成：
deliveryMode?: DeliveryMode;
```

```ts
// src/lib/cockpit/platform-stages.ts，import 里加 `import type { DeliveryMode } from './model';`
// 5 个函数签名的 `deliveryMode?: 'manual' | 'ai-faceless'` 全改成 `deliveryMode?: DeliveryMode`

export function stageFlowFor(platform: string, deliveryMode?: DeliveryMode): WorkStage[] {
  if (deliveryMode === 'ppt-narration' || deliveryMode === 'illustration-tts') {
    return ['inbox', 'topic', 'script', 'editing', 'publishing', 'review'];
  }
  if (deliveryMode === 'talking-head-broll') {
    return ['inbox', 'topic', 'script', 'recording', 'editing', 'publishing', 'review'];
  }
  return PLATFORM_STAGE_FLOW[platform] ?? DEFAULT_STAGE_FLOW;
}
```
（`isStageInFlow`/`nextStageFor`/`schedulableStagesFor` 三个函数内部只是把 `deliveryMode` 原样传给 `stageFlowFor`，不需要改逻辑，只改类型标注。）

**改名对照表（一次性全部替换，逐个改，不要用全局字符串替换工具，因为 `platform-stages.ts`/`content-detail.tsx`/`stage-stepper.tsx` 里改名的同时类型标注也要跟着换成 `DeliveryMode`）：**

| 文件 | 行号（改动前） | 改动 |
|---|---|---|
| `src/lib/cockpit/model.ts` | 126 | 字段类型改 `DeliveryMode` |
| `src/lib/cockpit/platform-stages.ts` | 18,19,33,38,54 | 签名类型改 `DeliveryMode`；第 19 行 `'ai-faceless'` 改判断逻辑（见上方代码块，同时处理 talking-head-broll） |
| `src/components/cockpit/content-detail.tsx` | 395 | `item.deliveryMode === 'ai-faceless'` 改成 `item.deliveryMode === 'ppt-narration'`（这里先只改这一处字面量判断，其余 UI 结构改动见 Task 10，不要在本任务顺手改 UI） |
| `src/components/cockpit/content-detail.tsx` | 1104,1105,1107,1110 | 同上，暂只改字面量，不改按钮结构（Task 10 处理） |
| `src/components/cockpit/stage-stepper.tsx` | 13,27 | 13 行 prop 类型改 `deliveryMode?: DeliveryMode`（import `DeliveryMode`），27 行字面量判断改 `=== 'ppt-narration'`——但根据 spec §1，`talking-head-broll` 的 editing 阶段同样显示"生成成片"，所以这一行的条件应该改成 `item.deliveryMode !== 'manual' && item.deliveryMode !== undefined`（即"非手动模式"都显示"生成成片"），不要写成只匹配 `ppt-narration` 一个值 |
| `tests/lib/cockpit/platform-stages.test.ts` | 203,205,206,223,229,235,236 | 字符串 `'ai-faceless'` 改 `'ppt-narration'`，新增至少 2 条 `talking-head-broll` 的断言（`stageFlowFor('douyin','talking-head-broll')` 应包含 `'recording'`，`stageFlowFor('douyin','ppt-narration')`/`'illustration-tts'` 都不应包含 `'recording'`） |

- [ ] Step 1: 按上表改 `model.ts`/`platform-stages.ts`（含 `talking-head-broll` 分支）
- [ ] Step 2: 改 `content-detail.tsx`/`stage-stepper.tsx` 的字面量引用（stage-stepper.tsx 按上表的"非手动即生成成片"逻辑）
- [ ] Step 3: 改测试文件断言 + 新增 `talking-head-broll` 用例
- [ ] Step 4: `npm run typecheck && npm run test` 全绿；grep 全仓库确认 `src/`/`tests/` 下再无 `'ai-faceless'` 残留（README/CSS 注释/历史 spec/plan 文档不用改，见下方备注）
- [ ] Step 5: commit `refactor(cockpit): 十九期 — DeliveryMode 类型收敛, ai-faceless 改名 ppt-narration, 新增 talking-head-broll 阶段流`

**备注**：`prisma/schema.prisma:679`、`src/app/cockpit.css:1115`、`README.md:806` 里的 `ai-faceless` 只是注释文字，不影响功能，本任务不用改；`docs/superpowers/plans/2026-08-18-ai-video-production.md` 等历史 spec/plan 文档是不可变历史记录，不要碰。

---

### Task 2: Prisma schema — `VideoProduction` 新字段 + `VolcTtsConfig` 新表

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces (Produces，Task 3/4/6/8/9/11/13 消费):**
```prisma
model VideoProduction {
  id             String   @id
  userId         String
  contentId      String
  status         String   @default("queued")
  mode           String   @default("ppt-narration") // ppt-narration|talking-head-broll|illustration-tts（交付方式，注意与 worker JobData.mode 的 preview/master 是两个不同概念）
  srt            String
  productionRoot String
  sourceVideoPath String? // talking-head-broll: 用户上传的出镜视频本地路径
  alignedActs    Json?    // talking-head-broll/illustration-tts: 对齐阶段产出的真实六幕边界 [{act,startMs,endMs}]
  rawTranscript  Json?    // talking-head-broll: ASR 原始 segments(真实原话, 供字幕烧录), illustration-tts 不填
  previewPath    String?
  masterPath     String?
  errorMessage   String?
  createdAt      String
  updatedAt      String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, contentId])
}

model VolcTtsConfig {
  id          String   @id @default(cuid())
  userId      String
  appId       String
  accessToken String   // 加密存储 (src/lib/crypto.ts encrypt())
  voiceType   String   @default("")
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])

  @@unique([userId])
}
```
在 `User` model 里给 `VolcTtsConfig` 加一条反向关系字段（照抄 `AIConfig`/`ImageGenConfig` 现有反向关系字段的写法，找到 `User` model 定义里 `aiConfigs`/`imageGenConfigs`（或类似命名）那几行，紧挨着加一行 `volcTtsConfig VolcTtsConfig?`）。

- [ ] Step 1: 按上面两段改 `schema.prisma`（`VideoProduction` 加 4 个新字段，位置放在 `srt` 和 `productionRoot` 之间/`productionRoot` 之后，跟现有字段顺序自然衔接即可；新增 `VolcTtsConfig` model，放在 `ImageGenConfig` 相关 model 定义附近）
- [ ] Step 2: `User` model 加反向关系字段
- [ ] Step 3: `npx prisma db push` 应用到本机开发库；`npx prisma generate` 刷新 client
- [ ] Step 4: `npm run typecheck && npm run test` 全绿（这一步不新增测试，纯 schema 变更，确认没有破坏依赖 Prisma Client 类型的既有代码）
- [ ] Step 5: commit `feat(schema): 十九期 — VideoProduction 新增交付方式字段, 新增 VolcTtsConfig 表`

---

### Task 3: 出镜视频上传 API 路由

**Files:**
- Create: `src/app/api/v1/cockpit/video-productions/[id]/upload-source/route.ts`
- Test: `tests/api/cockpit/video-production-upload.test.ts`

**Interfaces (Consumes Task 2; Produces，Task 8/10 消费):**
```ts
// POST /api/v1/cockpit/video-productions/[id]/upload-source
// multipart/form-data, 字段名 "video"
// 200: { success: true, data: { sourceVideoPath: string, status: "source_uploaded" } }
```

具体实现照抄 `src/app/api/v1/content/analyses/route.ts` 现有的 multipart 上传写法：
```ts
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-matroska)$/;

function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);
  if (vp.mode !== 'talking-head-broll') return fail('只有真人出镜模式需要上传视频', 400);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('multipart 解析失败', 400); }
  const video = form.get('video');
  if (!(video instanceof File)) return fail('缺少 video 字段', 400);
  if (!ALLOWED_VIDEO_MIME.test(video.type)) return fail(`不支持的视频格式: ${video.type}`, 400);
  if (video.size > MAX_BYTES) return fail(`视频超过 500MB 上限 (${(video.size / 1024 / 1024).toFixed(1)} MB)`, 400);

  const ext = safeExt(video.name, 'mp4');
  const sourceVideoPath = path.join(vp.productionRoot, `source.${ext}`);
  await fs.writeFile(sourceVideoPath, Buffer.from(await video.arrayBuffer()));

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: { sourceVideoPath, status: 'source_uploaded', updatedAt: new Date().toISOString() },
  });
  return ok({ sourceVideoPath: updated.sourceVideoPath, status: updated.status });
}
```

**Test（照抄 `tests/api/cockpit/video-productions.test.ts` 的 mock 风格）：**
- 归属别的用户 → 404
- `mode !== 'talking-head-broll'` → 400
- 上传非视频 MIME → 400
- 上传超过 500MB → 400（用一个假造的大 `File` 对象，`size` 属性直接赋值，不需要真的传 500MB 数据）
- 正常上传 → 200，`prisma.videoProduction.update` 被调用且 `status: 'source_uploaded'`

- [ ] Step 1: TDD；实现路由
- [ ] Step 2: `npm run typecheck && npm run test` 全绿
- [ ] Step 3: commit `feat(video-production): 十九期 — 真人出镜模式出镜视频上传路由`

---

### Task 4: 对齐阶段 DeepSeek 提示词模块

**Files:**
- Create: `src/lib/video-production/aligner-prompt.ts`
- Test: `tests/lib/video-production/aligner-prompt.test.ts`

**Interfaces (Consumes `ActKey`/`ScriptAct` from `@/lib/script/six-act`；Produces，Task 8 消费):**
```ts
import { z } from 'zod';
import { ACT_KEYS, type ActKey, type ScriptAct } from '@/lib/script/six-act';
import type { ContentPart } from '@/lib/llm/vision';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export const AlignedActSchema = z.object({
  act: z.enum(ACT_KEYS as [ActKey, ...ActKey[]]),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});
export const AlignerResponseSchema = z.object({
  acts: z.array(AlignedActSchema).length(6), // 六幕固定顺序: hook/concept_a/concept_b/trivia/synthesis/punchline
});
export type AlignedAct = z.infer<typeof AlignedActSchema>;
export type AlignerResponse = z.infer<typeof AlignerResponseSchema>;

export const ALIGNER = {
  buildSystemPrompt(): string;
  buildUserMessage(transcript: TranscriptSegment[], acts: ScriptAct[]): ContentPart[];
  responseSchema: typeof AlignerResponseSchema,
};
```

**`buildSystemPrompt()` 具体内容：**
```ts
buildSystemPrompt(): string {
  return `你是一个"语音对齐器"。给你一段真实录音的逐句转写(带真实时间戳)，和一份六幕脚本的结构参照(每幕的主张/要点关键词)，你的任务是判断真实录音里每一句话对应六幕脚本的哪一幕，输出每一幕在真实录音里的起止时间(毫秒)。

重要前提: 说话人是照着要点自由发挥的，不是逐字念稿——录音原话和脚本文字大概率不一样，你要做的是语义匹配，不是文字匹配。

规则:
- 六幕顺序固定: hook(开场钩子) → concept_a(概念A) → concept_b(概念B) → trivia(冷知识) → synthesis(知识串联) → punchline(金句收尾)，说话人通常按这个顺序讲，但允许跳过某一幕。
- 六个时间区间首尾相接，覆盖录音从开始到结束的整个时长，不留空隙、不重叠。
- 如果说话人完全没讲到某一幕的内容，把该幕的 startMs 和 endMs 设成同一个值(零时长)，但仍要输出这一幕(六个都必须出现在结果里)。
- 允许合理误差，不追求逐词精确，只要求"大致讲到这个话题的时间段"。

只输出结构化 JSON，不要输出解释文字。`;
},
```

**`buildUserMessage(transcript, acts)` 具体内容：**
```ts
buildUserMessage(transcript, acts): ContentPart[] {
  const transcriptText = transcript.map((s) => `[${(s.startSec * 1000).toFixed(0)}ms-${(s.endSec * 1000).toFixed(0)}ms] ${s.text}`).join('\n');
  const actsText = acts.map((a) => `${a.act}: 主张="${a.narration.slice(0, 40)}..." 关键词=${a.beats.map((b) => b.keyword).join('、')}`).join('\n');
  return [{
    type: 'text',
    text: `真实录音转写(真实时间戳+真实原话):\n${transcriptText}\n\n六幕脚本结构参照(仅供语义比对，不要求逐字匹配):\n${actsText}\n\n请输出六幕在这段录音里的真实起止时间。`,
  }];
},
```

**Test（`tests/lib/video-production/aligner-prompt.test.ts`）：**
- `buildSystemPrompt()` 含"语义匹配"/"自由发挥"关键字符串（确认没有被误改成要求逐字匹配）
- `buildUserMessage(transcript, acts)` 返回的 `text` 含转写文本的真实时间戳格式化结果、含六幕的关键词
- `AlignerResponseSchema` 正例：6 个 act 顺序不限（zod 不强制顺序，只强制 length 6）、每个 `startMs<=endMs`（此约束不在 schema 层强制，留给 Director 消费时处理，schema 只校验类型和数量）
- 反例：`acts` 长度不是 6 → 拒绝；`act` 不在 `ACT_KEYS` 里 → 拒绝

- [ ] Step 1: TDD
- [ ] Step 2: `npm run typecheck && npm run test` 全绿
- [ ] Step 3: commit `feat(video-production): 十九期 — 对齐阶段提示词模块(真实语音语义匹配六幕边界)`

---

### Task 5: 真实 SRT 合成（对齐结果驱动）

**Files:**
- Modify: `src/lib/video-production/srt-synthesis.ts`（新增导出，不改 `synthesizeSrtFromSixActScript`）
- Test: `tests/lib/video-production/srt-synthesis.test.ts`（追加用例）

**Interfaces (Consumes Task 4 的 `AlignedAct`; Produces，Task 8/14 消费):**
```ts
import type { AlignedAct } from './aligner-prompt';

export function buildSrtFromAlignedActs(
  alignedActs: AlignedAct[],
  narrations: Record<string, string>, // act key -> 该幕字幕显示文本
): string;
```

实现：过滤掉 `startMs===endMs`（零时长/未讲到的幕）的条目，其余按 `startMs` 排序后逐条生成标准 SRT 块（序号、`formatTimestamp(startMs) --> formatTimestamp(endMs)`、`narrations[act]` 文本），复用本文件已有的私有 `formatTimestamp` 函数（不导出，同文件内直接调用）。

**Test（追加到现有测试文件）：**
- 6 幕全部非零时长 → 产出 6 个 SRT 块，序号 1-6
- 某一幕零时长（`startMs===endMs`）→ 该幕被跳过，产出块数减少，序号仍连续（不留空号）
- 时间戳格式正确（复用现有 `formatTimestamp` 测试já验证过的格式，这里只需确认 `buildSrtFromAlignedActs` 调用产出的实际字符串符合 `HH:MM:SS,mmm --> HH:MM:SS,mmm` 格式）

- [ ] Step 1: TDD
- [ ] Step 2: `npm run typecheck && npm run test` 全绿
- [ ] Step 3: commit `feat(video-production): 十九期 — buildSrtFromAlignedActs, 真实时间戳驱动的 SRT 合成`

---

### Task 6: ffmpeg 挖空替换（cutaway 合成）

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`（新增导出，紧跟 `concatClips` 之后）
- Test: `tests/lib/video/ffmpeg.test.ts`（追加纯函数用例）+ `tests/lib/video-production/composite-cutaway.test.ts`（新建，真实系统测试）

**Interfaces (Produces，Task 8 消费):**
```ts
export interface CutawaySegment {
  startMs: number;
  endMs: number;
  clipPath: string; // 该区间要替换成的 B-roll 画面文件路径(已渲染好的无声视频)
}
export interface CompositeCutawayOpts {
  sourceVideoPath: string; // 原始出镜视频(含音轨)
  segments: CutawaySegment[]; // 按 startMs 升序，互不重叠
  outputPath: string;
}
export function buildCompositeCutawayArgs(opts: CompositeCutawayOpts): string[];
export async function compositeCutawayVideo(opts: CompositeCutawayOpts): Promise<void>;
```

**实现思路（filter_complex，具体语法实施时用真实文件调通为准，这里给出设计契约而非强制语法）：**
1. 把 `sourceVideoPath` 按 `segments` 的时间点切成"原始片段"和"替换片段"交替的序列——原始片段用 `trim=start:end,setpts=PTS-STARTPTS`，替换片段直接引用对应 `clipPath` 的完整画面（B-roll clip 的时长应该正好等于它替换的那个 segment 的 `endMs-startMs`，如果不完全相等允许 ffmpeg 自动截断/循环到目标时长，实施时选一种策略并在代码注释里写清楚选了哪种）。
2. 用 `concat` filter 把切好的画面片段依次拼接。
3. 音频轨道：整段直接用 `sourceVideoPath` 的原始音轨，不做任何切分处理，映射到最终输出（画面切换不影响音轨连续性）。
4. `-map` 显式指定最终输出的视频流来自 concat 结果、音频流来自源文件原始音轨。

**Test（纯函数部分，`ffmpeg.test.ts` 追加）：**
- `buildCompositeCutawayArgs` 给定 1 个 segment，断言参数数组里含 `-filter_complex` 关键字、含 `sourceVideoPath`、含 `clipPath`、含 `outputPath`

**Test（真实系统测试，`composite-cutaway.test.ts` 新建，仿 `shot-renderer.test.ts` 先例——不 mock ffmpeg，跑真实二进制）：**
- 准备一个真实的 3 秒纯色测试视频（可以用 ffmpeg 的 `lavfi` 测试源现场生成，比如 `-f lavfi -i color=blue:s=1920x1080:d=3` 加一段真实音频测试源如 `-f lavfi -i sine=frequency=1000:duration=3`，合成一个真实的"出镜视频"素材）作为 `sourceVideoPath`
- 再生成一个 1 秒纯色测试视频作为 B-roll `clipPath`
- 调用 `compositeCutawayVideo({sourceVideoPath, segments: [{startMs:1000,endMs:2000,clipPath}], outputPath})`
- 用现有 `probeVideo` 断言输出文件总时长约等于 3 秒（源视频时长不变）、有音频流、有视频流
- 断言输出文件真实存在且非空

- [ ] Step 1: TDD 纯函数部分
- [ ] Step 2: 实现 `compositeCutawayVideo`，用真实测试素材跑通验证
- [ ] Step 3: `npm run typecheck && npm run test` 全绿（这条真实系统测试预计比 `shot-renderer.test.ts` 更慢，属于预期）
- [ ] Step 4: commit `feat(video-production): 十九期 — ffmpeg 挖空替换合成(真人出镜+B-roll 切探)`

---

### Task 7: ffmpeg 字幕烧录

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`（新增导出）
- Test: `tests/lib/video/ffmpeg.test.ts`（追加）+ `tests/lib/video-production/burn-captions.test.ts`（新建，真实系统测试）

**Interfaces (Produces，Task 8 消费):**
```ts
export interface BurnCaptionsOpts {
  videoPath: string;
  srt: string; // SRT 格式字幕内容(不是文件路径，函数内部负责写临时文件)
  outputPath: string;
}
export function buildBurnCaptionsArgs(opts: { videoPath: string; srtPath: string; outputPath: string }): string[];
export async function burnCaptions(opts: BurnCaptionsOpts): Promise<void>;
```

**实现：** `burnCaptions` 先把 `opts.srt` 写入 `path.join(os.tmpdir(), 'captions-' + randomUUID() + '.srt')`，再调用 `buildBurnCaptionsArgs`/`execFileAsync`，用 ffmpeg 的 `subtitles` filter（`-vf subtitles=<srtPath>`）烧录（**先用普通 `.srt` 走 `subtitles` filter，不做 `.ass` 动画字幕**——spec 风险表里把 `.ass` 列为"若 ffmpeg/libass 支持则做，不支持则退回普通字幕"的降级方案，本任务直接选普通 `.srt` 作为第一版实现，不做动画字幕，这是本任务范围内的既定简化，不是遗漏）。

**Test（真实系统测试，仿 Task 6）：**
- 准备一个真实的 2 秒纯色测试视频作为 `videoPath`
- 一份最小 SRT 内容（1 条字幕，覆盖前 1 秒）
- 调用 `burnCaptions`，用 `probeVideo` 断言输出文件存在、时长约 2 秒、有视频流
- （不需要断言字幕真的可见——像素级 OCR 验证超出合理测试范围，"ffmpeg 命令真实跑通产出合法视频文件"已经是有效验证）

- [ ] Step 1: TDD 纯函数部分
- [ ] Step 2: 实现 `burnCaptions`，真实素材跑通
- [ ] Step 3: `npm run typecheck && npm run test` 全绿
- [ ] Step 4: commit `feat(video-production): 十九期 — ffmpeg 字幕烧录(真实原话字幕)`

---

### Task 8: Worker — `talking-head-broll` 分支接线

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`
- Test: 无新增测试文件（集成任务，各阶段已有单测，验证方式是 Task 15 的真实 E2E；照抄十五期 Task 7 的先例）

**Interfaces (Consumes Task 1-7 全部产物):**

在现有 `handleProduce` 的 `try` 块最前面，读出 `vp.mode`，按值分岔到三个处理函数（`handlePptNarration`/`handleTalkingHeadBroll`/`handleIllustrationTts`，`ppt-narration` 分支就是现有代码原样抽出，不改行为）。`handleTalkingHeadBroll` 流程：

```ts
async function handleTalkingHeadBroll(vp: VideoProduction, deepseekKey: string, fps: number, ...) {
  if (!vp.sourceVideoPath) throw new Error('尚未上传出镜视频');

  await setStatus('directing'); // 复用现有状态值，语义上这里其实是"转写+对齐"，不新增状态字符串
  const audioPath = path.join(vp.productionRoot, 'source-audio.wav');
  await extractAudio({ videoPath: vp.sourceVideoPath, audioPath }); // 复用现有 ffmpeg.ts 导出
  const whisper = new LocalWhisperClient();
  const transcription = await whisper.transcribe(audioPath); // 复用现有 local-whisper.ts

  const acts = /* 从 content 关联的 ScriptDraft 解出 acts，同现有 route.ts 的 parseDraftOutput 用法 */;
  const alignLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
  const { result: aligned } = await alignLLM.callStructured({
    systemPrompt: ALIGNER.buildSystemPrompt(),
    userMessage: ALIGNER.buildUserMessage(transcription.segments, acts),
    responseSchema: ALIGNER.responseSchema,
  });
  await prisma.videoProduction.update({ where: { id: vp.id }, data: {
    alignedActs: aligned.acts, rawTranscript: transcription.segments, updatedAt: new Date().toISOString(),
  }});

  const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
  const srt = buildSrtFromAlignedActs(aligned.acts, narrations);

  await setStatus('building');
  // 复用 DIRECTOR/BUILDER/renderShotToClip，与 ppt-narration 分支完全相同的调用方式，
  // 只是这次 srt 是真实对齐出来的，Director 产出的 shots 语义是"切探时间点"
  const direction = /* 同现有 DIRECTOR 调用 */;
  const cutawaySegments: CutawaySegment[] = [];
  for (const shot of direction.shots) {
    const built = /* 同现有 BUILDER 调用 */;
    const clipPath = /* 同现有 renderShotToClip 调用 */;
    cutawaySegments.push({ startMs: shot.startMs, endMs: shot.endMs, clipPath });
  }

  await setStatus('assembling');
  const compositedPath = path.join(vp.productionRoot, 'composited.mp4');
  await compositeCutawayVideo({ sourceVideoPath: vp.sourceVideoPath, segments: cutawaySegments, outputPath: compositedPath });
  const finalPath = path.join(vp.productionRoot, outputFileName);
  await burnCaptions({ videoPath: compositedPath, srt: buildCaptionSrtFromTranscript(transcription.segments), outputPath: finalPath });

  await setStatus(readyStatus, { [outputField]: finalPath });
}
```

（`buildCaptionSrtFromTranscript` 是一个小的新增辅助函数——把 `TranscriptSegment[]`(真实原话) 转成 SRT 格式，可以直接写在 worker 文件里或者 `srt-synthesis.ts` 里加一个不需要六幕对齐的简单版本，实施时选一种，逻辑上就是"每个 segment 一条字幕块"，不需要新建 Task，本 Task 内顺手写。）

**master 模式（正式导出）：** 复用现有"读取持久化的 direction.json/source.html 重渲染，不重新调 LLM"的模式（十五期 Task 7 已建立的先例），`talking-head-broll` 的 master 模式同样只重新渲染 B-roll 片段(30fps)+重新走一遍挖空替换+字幕烧录，不重新做 ASR/对齐（对齐结果已经持久化在 `alignedActs`/`rawTranscript` 字段里，直接复用）。

- [ ] Step 1: 抽出 `ppt-narration` 分支为独立函数（现状搬迁，零行为改动）
- [ ] Step 2: 实现 `handleTalkingHeadBroll`（preview 模式）
- [ ] Step 3: 实现 `talking-head-broll` 的 master 模式（复用持久化对齐结果）
- [ ] Step 4: `npm run typecheck && npm run test` 全绿，确认 `ppt-narration` 分支现有测试/行为零回归
- [ ] Step 5: commit `feat(video-production): 十九期 — worker 真人出镜+B-roll 分支(ASR+对齐+切探合成+字幕烧录)`

---

### Task 9: 火山引擎 TTS 技术验证 + 客户端封装

**Files:**
- Create: `src/lib/tts/volcengine.ts`
- Test: `tests/lib/tts/volcengine.test.ts`

**Interfaces (Produces，Task 11/14 消费):**
```ts
export interface VolcTtsOpts {
  appId: string;
  accessToken: string;
  voiceType?: string;
}
export interface VolcTtsResult {
  audioPath: string; // 本地临时文件路径(wav/mp3, 具体格式实施时查文档确认)
  durationMs: number;
}
export async function synthesizeVolcTts(text: string, outputPath: string, opts: VolcTtsOpts): Promise<VolcTtsResult>;
```

**本任务第一步是技术验证，不是直接写正式代码**（spec 风险表明确要求）：先查火山引擎语音合成 API 官方文档（鉴权方式、请求格式、返回是直接音频二进制还是 base64、是否需要 WebSocket），写一个最小可行的调用脚本，用测试账号的 appid+token（**不要用真实生产密钥硬编码进代码或测试文件，走环境变量**）真实调通一次，产出一段真实音频文件，确认能读出 `durationMs`（用现有 `probeVideo`/`ffprobe` 或者音频专用探测方式）。验证通过后再写正式的 `synthesizeVolcTts` 函数封装。如果技术验证发现 API 契约与本文档假设不符（比如是 WebSocket 而非 HTTP），按验证结果调整实现，不强行套用一个错误的契约。

**Test：** 由于依赖真实外部 API + 真实密钥，测试用 mock（不在自动化测试里打真实 API），只测参数拼装/错误处理逻辑：
- 缺少 `appId`/`accessToken` → 抛出清晰错误
- 正常响应（mock）→ 正确写入 `outputPath`，返回 `durationMs`
- API 返回错误状态码（mock）→ 抛出包含错误信息的异常

- [ ] Step 1: 查文档，写验证脚本，真实调通一次（人工步骤，实施时记录实际观察到的 API 契约到 report 里）
- [ ] Step 2: 按验证结果实现正式 `synthesizeVolcTts`，TDD 补单测
- [ ] Step 3: `npm run typecheck && npm run test` 全绿
- [ ] Step 4: commit `feat(tts): 十九期 — 火山引擎语音合成客户端封装`

---

### Task 10: 火山 TTS 配置加密存储 + 设置页卡片

**Files:**
- Create: `src/app/api/v1/tts/volc-config/route.ts`
- Create: `src/components/cockpit/settings-cards/volc-tts-config-card.tsx`
- Modify: `src/components/cockpit/views/settings.tsx`（挂载新卡片）
- Test: `tests/api/tts/volc-config.test.ts`

**Interfaces (Consumes Task 2 的 `VolcTtsConfig`, Task 9 的加密约定; Produces，Task 14 消费):**

API 路由照抄 `src/app/api/v1/ai/config/route.ts` 的 GET/POST 结构（Explore 报告已给出完整现有代码），字段换成 `appId`/`accessToken`/`voiceType`，`@@unique([userId])` 决定这是 upsert 单条记录而不是列表：
```ts
// GET → { appId, voiceType, accessTokenMasked, hasConfig: boolean }
// POST { appId, accessToken, voiceType? } → { id }
```

卡片组件照抄 `ai-provider-card.tsx` 的结构（GET 拉现状 → 表单 → POST 保存 → 本地状态清空明文）。挂载到 `settings.tsx`，插在现有 `<RadarConfigCard />` 之后（跟随现有卡片罗列顺序）。

**Test：**
- GET 无配置 → `hasConfig: false`
- POST 缺 `appId`/`accessToken` → 400
- POST 正常 → 200，`accessToken` 落库前经过 `encrypt()`（断言传给 `prisma.volcTtsConfig.upsert` 的 `accessToken` 值不等于明文原文）
- GET 有配置 → 返回掩码，不返回明文

- [ ] Step 1: TDD API 路由
- [ ] Step 2: 实现设置卡片组件，`npm run dev` 真实走查一遍保存/回显
- [ ] Step 3: `npm run typecheck && npm run test` 全绿
- [ ] Step 4: commit `feat(cockpit): 十九期 — 火山 TTS 配置加密存储 + 设置页卡片`

---

### Task 11: Builder 阶段插画风格参数

**Files:**
- Modify: `src/lib/video-production/builder-prompt.ts`
- Test: `tests/lib/video-production/builder-prompt.test.ts`（追加）

**Interfaces (向后兼容扩展，Task 14 消费):**
```ts
export const BUILDER = {
  buildSystemPrompt(palette: string[], visualStyle: 'card' | 'illustration' = 'card'): string;
  buildUserMessage(shot: Shot): ContentPart[]; // 不变
  responseSchema: BuilderResponseSchema,
};
```

`buildSystemPrompt` 现有实现里"第一版构图从简：文字卡片+简单几何图形+基础过渡（淡入淡出/位移）即可，不需要复杂运镜或隐喻。"这一句（Explore 报告已确认原文），改成按 `visualStyle` 参数分岔：
```ts
const styleGuidance = visualStyle === 'illustration'
  ? '插画风格：手绘感矢量插画构图，扁平色块+简单人物/物件剪影+柔和过渡动画，避免写实照片风格，避免复杂运镜或隐喻。'
  : '第一版构图从简：文字卡片+简单几何图形+基础过渡（淡入淡出/位移）即可，不需要复杂运镜或隐喻。';
```
其余提示词文本不变，`visualStyle` 参数默认值 `'card'` 保证所有现有调用点（`ppt-narration`/`talking-head-broll` 都不传这个参数）行为完全不变。

**Test（追加）：**
- 不传 `visualStyle`（或显式传 `'card'`）→ 输出的系统提示词与改动前逐字一致（回归断言，直接对比 Task 11 之前 `builder-prompt.test.ts` 里已有的"含 window.__timelines 关键字符串"等断言仍然全部通过，外加一条"含'文字卡片'关键字符串"确认默认分支文本不变）
- 传 `visualStyle: 'illustration'` → 输出含"插画风格"关键字符串，不含"文字卡片"

- [ ] Step 1: TDD
- [ ] Step 2: `npm run typecheck && npm run test` 全绿，确认 Task 8/现有 `ppt-narration`/`talking-head-broll` 调用点都不受影响（这两处调用 `BUILDER.buildSystemPrompt` 都不传第二个参数，typecheck 通过即可确认签名兼容）
- [ ] Step 3: commit `feat(video-production): 十九期 — Builder 阶段新增 visualStyle 插画风格参数`

---

### Task 12: ffmpeg 音轨混流

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`
- Test: `tests/lib/video/ffmpeg.test.ts`（追加）+ `tests/lib/video-production/mux-audio.test.ts`（新建，真实系统测试）

**Interfaces (Produces，Task 14 消费):**
```ts
export interface MuxAudioOpts {
  videoPath: string; // 只有画面(拼接后的 B-roll 序列)，可能有也可能没有原始音轨
  audioPath: string; // TTS 合成出的语音轨道
  outputPath: string;
}
export function buildMuxAudioArgs(opts: MuxAudioOpts): string[];
// ffmpeg -y -i {videoPath} -i {audioPath} -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest {outputPath}
export async function muxAudioTrack(opts: MuxAudioOpts): Promise<void>;
```

**Test（纯函数，追加到 `ffmpeg.test.ts`）：**
- `buildMuxAudioArgs` 断言含 `-map 0:v:0`、`-map 1:a:0`、`-shortest`、两个输入路径都出现在参数里

**Test（真实系统测试）：**
- 真实生成一段 2 秒纯色无声测试视频 + 一段 2 秒正弦波测试音频
- 调用 `muxAudioTrack`，用 `probeVideo` 断言输出文件同时有视频流和音频流、时长约 2 秒

- [ ] Step 1: TDD 纯函数部分
- [ ] Step 2: 实现 `muxAudioTrack`，真实素材跑通
- [ ] Step 3: `npm run typecheck && npm run test` 全绿
- [ ] Step 4: commit `feat(video-production): 十九期 — ffmpeg 音轨混流(TTS 配音)`

---

### Task 13: TTS 驱动的对齐（复用 §4.2 逻辑）

**Files:**
- Modify: `src/lib/video-production/srt-synthesis.ts`（新增一个辅助导出，服务 illustration-tts 模式）
- Test: `tests/lib/video-production/srt-synthesis.test.ts`（追加）

**Interfaces (Consumes Task 9 的 `synthesizeVolcTts`; Produces，Task 14 消费):**
```ts
export interface TtsActResult {
  act: ActKey;
  audioPath: string;
  durationMs: number;
}
export function ttsResultsToAlignedActs(results: TtsActResult[]): AlignedAct[];
// 按 results 数组顺序(应为六幕固定顺序)累加时长，得出每幕在"拼接后的完整语音轨道"里的 startMs/endMs
```

这个函数是纯逻辑（不调用 TTS 本身，TTS 调用在 Task 14 worker 里逐幕调 `synthesizeVolcTts`），输入是每一幕已经合成好的语音时长，输出跟 Task 4 的 `AlignedAct` 同构，可以直接喂给 Task 5 的 `buildSrtFromAlignedActs`。

**Test：**
- 6 个 `TtsActResult` 顺序输入 → 累加出正确的 `startMs`/`endMs`（第一幕 `startMs=0`，第二幕 `startMs=` 第一幕的 `durationMs`，以此类推）
- 验证累加逻辑对 0 时长（理论上 TTS 不会产出 0 时长，但边界情况测一下）不会产生负数或 NaN

- [ ] Step 1: TDD
- [ ] Step 2: `npm run typecheck && npm run test` 全绿
- [ ] Step 3: commit `feat(video-production): 十九期 — TTS 时长驱动的对齐结果转换(插画模式)`

---

### Task 14: Worker — `illustration-tts` 分支接线

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`

**Interfaces (Consumes Task 9/11/12/13):**

```ts
async function handleIllustrationTts(vp: VideoProduction, ttsConfig: VolcTtsConfig, ...) {
  await setStatus('directing'); // 语义上是"TTS 配音"阶段，复用现有状态值
  const acts = /* 同 Task 8，解出六幕脚本 */;
  const ttsResults: TtsActResult[] = [];
  for (const act of acts) {
    const audioPath = path.join(vp.productionRoot, `tts-${act.act}.wav`);
    const { durationMs } = await synthesizeVolcTts(act.narration, audioPath, {
      appId: ttsConfig.appId, accessToken: decrypt(ttsConfig.accessToken), voiceType: ttsConfig.voiceType,
    });
    ttsResults.push({ act: act.act, audioPath, durationMs });
  }
  const alignedActs = ttsResultsToAlignedActs(ttsResults);
  const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
  const srt = buildSrtFromAlignedActs(alignedActs, narrations);

  await setStatus('building');
  // 同 ppt-narration 分支调 DIRECTOR，但 BUILDER 调用传 visualStyle: 'illustration'
  // ...渲染每个 shot 为 clip...

  await setStatus('assembling');
  const concatenatedAudio = /* 用现有音频处理方式把 ttsResults 的 6 段音频按顺序拼接成一条完整语音轨——
    可以复用 concatClips 相同的 concat demuxer 思路对纯音频文件做拼接，实施时确认 ffmpeg 对纯音频
    concat 的语法(不需要 -c copy 对视频流那套，纯音频通常也支持 concat demuxer) */;
  const videoOnlyPath = path.join(vp.productionRoot, 'video-only.mp4');
  await concatClips({ clipPaths, outputPath: videoOnlyPath, concatListPath: ... }); // 复用现有函数
  const finalPath = path.join(vp.productionRoot, outputFileName);
  await muxAudioTrack({ videoPath: videoOnlyPath, audioPath: concatenatedAudio, outputPath: finalPath });

  await setStatus(readyStatus, { [outputField]: finalPath });
}
```

`vp.mode==='illustration-tts'` 时需要读取当前用户的 `VolcTtsConfig`（Task 10 产物），缺失时抛出清晰错误（"请先在设置页配置火山 TTS"），流程走进统一的 `catch` 落 `errorMessage`（同现有模式）。

master 模式：同 Task 8 的先例，复用持久化的 `direction.json`/`source.html`，只在 30fps 重渲染画面+重新拼接+重新混流，**不重新调 TTS**（`alignedActs` 已持久化，`concatenatedAudio` 需要保留文件路径供 master 阶段复用，不要每次 master 都重新合成语音——实施时确认音频文件在 `productionRoot` 里不会被清理）。

- [ ] Step 1: 实现 `handleIllustrationTts`（preview 模式）
- [ ] Step 2: 实现 master 模式（复用持久化 TTS 音频，不重新调用）
- [ ] Step 3: `npm run typecheck && npm run test` 全绿，确认 `ppt-narration`/`talking-head-broll` 两个既有分支零回归
- [ ] Step 4: commit `feat(video-production): 十九期 — worker 插画+TTS 配音分支`

---

### Task 15: 前端接线 — 4 选一交付方式 + 录制阶段上传 + 生成面板多模式

**Files:**
- Modify: `src/components/cockpit/content-detail.tsx`
- Modify: `src/components/cockpit/video-production-panel.tsx`

**Interfaces (Consumes Task 1-14 全部产物):**

1. **交付方式选择器**（现有 1104-1108 行的 2 按钮块扩成 4 按钮）：
```tsx
<div className="delivery-mode-options">
  <button className={item.deliveryMode !== 'manual' ? '' : 'active'} onClick={() => update({ deliveryMode: 'manual' })}>手动拍剪</button>
  <button className={item.deliveryMode === 'ppt-narration' ? 'active' : ''} onClick={() => update({ deliveryMode: 'ppt-narration' })}>PPT 读稿形式</button>
  <button className={item.deliveryMode === 'talking-head-broll' ? 'active' : ''} onClick={() => update({ deliveryMode: 'talking-head-broll' })}>口播视频配字幕特效</button>
  <button className={item.deliveryMode === 'illustration-tts' ? 'active' : ''} onClick={() => update({ deliveryMode: 'illustration-tts' })}>插画动画形式</button>
</div>
{item.deliveryMode === 'talking-head-broll' ? <small className="field-hint">选择后「录制」步骤变成上传出镜视频，「剪辑」步骤会变成「生成成片」。</small> : null}
{(item.deliveryMode === 'ppt-narration' || item.deliveryMode === 'illustration-tts') ? <small className="field-hint">选择后「录制」步骤会跳过，「剪辑」步骤会变成「生成成片」——由 AI 自动产出视频。</small> : null}
```

2. **`recording` 标签页**：`item.deliveryMode === 'talking-head-broll'` 时渲染上传控件（一个 `<input type="file" accept="video/*">` + 上传按钮，POST 到 Task 3 的 `upload-source` 路由，上传中禁用按钮显示进度，上传成功后展示"已上传"状态），其余情况保持现状不变（`SixActGuidePanel`/备注框逻辑原样）。

3. **`editing` 标签页**：把现有 `item.deliveryMode === 'ppt-narration' ? <VideoProductionPanel .../> : <手动剪辑清单/>` 的二选一，改成 `item.deliveryMode !== 'manual' ? <VideoProductionPanel contentId={item.id} /> : <手动剪辑清单/>`（`VideoProductionPanel` 内部已经是通用轮询逻辑，三种 AI 模式共用同一个面板组件，不需要按模式再分岔渲染——面板本身不知道也不需要知道具体是哪种模式，只是显示状态轮询+预览+确认导出，这是 Task 15 唯一需要新写的产品判断：三种 AI 模式复用同一套"生成成片"面板 UI，不为每种模式单独做面板）。

4. **`video-production-panel.tsx`**：`STATUS_LABEL` 追加 `source_uploaded: '视频已上传，等待生成'`；`talking-head-broll` 模式下 `start()` 调用前需要确认 `sourceVideoPath` 已存在（如果还没上传，"开始生成"按钮应该禁用或提示"请先上传出镜视频"）——这需要面板知道当前内容的 `deliveryMode`，`VideoProductionPanel` 的 props 增加 `deliveryMode: DeliveryMode`（从 `content-detail.tsx` 传入 `item.deliveryMode`）。

- [ ] Step 1: 改交付方式选择器（4 按钮）
- [ ] Step 2: 改 `recording` 标签页（`talking-head-broll` 上传控件）
- [ ] Step 3: 改 `editing` 标签页（三种 AI 模式共用面板）
- [ ] Step 4: 改 `video-production-panel.tsx`（`STATUS_LABEL` 新增状态 + `deliveryMode` prop + 上传前置校验）
- [ ] Step 5: `npm run dev` 真实走查：三种交付方式各选一遍，确认录制/剪辑标签页渲染正确、上传控件能选文件（不需要真的跑完整条流水线，跑通到"能发起上传请求"即可，完整流水线验证在 Task 16）
- [ ] Step 6: `npm run typecheck && npm run test` 全绿
- [ ] Step 7: commit `feat(cockpit): 十九期 — 前端接线三种 AI 交付方式(选择器+上传控件+生成面板复用)`

---

### Task 16: 收尾 — 真实 E2E（三种模式各跑一遍）+ README

**Files:**
- README.md
- 无代码改动（若走查发现真 bug，按先例单独开 fix commit）

**真实 E2E 走查（`npm run dev`，真花真实 DeepSeek/火山 TTS 额度）：**
1. **PPT 读稿**：确认改名后功能与十五期验证结果一致（零回归）。
2. **口播+B-roll+字幕**：拿一段真实短视频（哪怕手机随便录一段几句话的口播）走一遍完整流程——上传→ASR→对齐→Director→Builder→渲染→挖空合成→字幕烧录→预览→确认导出。记录实际观察（对齐准确度主观感受如何、B-roll 切换是否流畅、字幕是否清晰可读）。
3. **插画+TTS**：走一遍完整流程——TTS 逐幕配音→对齐→Director→Builder(插画风格)→渲染→拼接→混流→预览→确认导出。记录实际观察（TTS 音色自然度、插画风格是否真的区别于卡片风格、音画是否同步）。

- [ ] Step 1: 三种模式各走一遍真实 E2E，记录观察（分镜数量、各阶段耗时、产物文件大小、主观质量评价），真 bug 按先例单独 fix commit
- [ ] Step 2: README 补十九期段落（三种交付方式的使用说明 + 已知限制：①仍无配音、②对齐允许误差不追求逐词精确、③字幕是静态烧录不是动画效果、③需要先在设置页配置火山 TTS 才能用插画模式）
- [ ] Step 3: `npm run typecheck && npm run test && npm run build` 全绿；commit `docs(video-production): 十九期收尾 — 三模式真实 E2E 走查 + README 对齐`

---

## Self-Review 记录

- **Spec 覆盖**：§0 决策表 → Task 1（交付方式结构）；§1 → Task 1；§2 → 无新开发，仅改名（Task 1）；§3（②全部子节）→ Task 2/3/4/5/6/7/8；§4（③全部子节）→ Task 2/9/10/11/12/13/14；§5 YAGNI 未越界（未做摄像头录制、未做声音克隆、未做①配音补齐、未做逐字精确对齐、未做批量并发）；§6 风险——ffmpeg 挖空替换先做最小验证用例（Task 6）、对齐允许误差已写进 Task 4 提示词、TTS 契约先验证再实现（Task 9）、`.ass` 动画字幕降级为普通字幕直接选定（Task 7）、Builder 参数扩展默认值保证零回归（Task 11 + Task 14 交叉验证）。
- **类型一致性**：`DeliveryMode`（Task 1 定义）在 `platform-stages.ts`/`content-detail.tsx`/`stage-stepper.tsx`/`video-production-panel.tsx`（Task 15）间统一引用；`AlignedAct`（Task 4 定义）被 Task 5 `buildSrtFromAlignedActs`、Task 8 worker、Task 13 `ttsResultsToAlignedActs` 共用同一个类型，未出现同名不同形状的重复定义；`VideoProduction.mode`（Task 2 新增字段）与 worker 既有 `JobData.mode`（preview/master）的命名冲突已在 Global Constraints 显式提示，Task 8/14 的示例代码里两者从不在同一处被当成同一个变量使用。
- **已知不确定点（实施核实记账本）**：火山引擎 TTS 具体请求/响应格式、鉴权方式（Task 9 已安排"先验证再实现"步骤，不假设具体契约）；ffmpeg `filter_complex` 挖空替换的具体语法（Task 6 给出设计契约，具体语法留给实施时用真实素材调通）；`.ass` 动画字幕的 ffmpeg/libass 支持情况（Task 7 已直接决定降级为普通 `.srt`，不是遗漏而是既定简化）；对齐阶段 DeepSeek 判断准确度在真实自由发挥场景下的实际表现（Task 16 真实 E2E 走查阶段才能拿到真实反馈，可能需要提示词微调，但不在本计划任务范围内预先假设需要几轮迭代）。
