# 无人出镜 AI 自动生成成片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 六幕脚本生成后，用户可以选择"AI 自动生成无人出镜成片"，由 DeepSeek 复刻 Director/Builder 两阶段 + 本机无头浏览器渲染 + ffmpeg 拼接，产出预览片供确认，确认后导出正式成片——全程无需用户录制/剪辑。

**Architecture:** 复用现有 BullMQ worker 模式（对标 `content-analyze-worker.ts`）新增一个多阶段任务；复用现有 `DeepSeekTextLLM.callStructured` 模式（对标 `hook.ts` 等 prompt 模块）做 Director/Builder 两次结构化 LLM 调用；复用现有 `src/lib/video/ffmpeg.ts` 的"纯函数构造参数 + execFileAsync 执行"模式扩展渲染/拼接能力；内容详情页的阶段流按 `deliveryMode` 分岔（不新增 `ContentStage` 枚举值，复用 `editing` 阶段位承载新面板，看板本身不动）。

**Tech Stack:** 同前 + `playwright-core`（已是项目依赖，2026-08-17 会话已验证headless Chromium 可用）+ 本机 `ffmpeg`（已装）。无新增 npm 依赖。

## Global Constraints

- **不新增 `ContentStage` 枚举值**——`deliveryMode:'ai-faceless'` 的内容跳过 `recording`，复用既有 `editing` 阶段位承载"生成成片"面板。
- **看板（`pipeline.tsx`/`platform.tsx`）本身不动**——`stageFlowFor(platformFilter)` 那个调用点明确不传 `deliveryMode`，`ai-faceless` 内容的 `stage` 永远不会落在 `recording`，"录制"列对它天然是空的，不需要改动看板列生成逻辑。
- **`stageLabelFor`/`nextActionFor` 不改签名**——"生成成片"这个展示文案只在内容详情页局部用三元表达式覆盖（`item.deliveryMode==='ai-faceless' && stage==='editing' ? '生成成片' : stageLabelFor(...)`），不通过共享工具函数传播到看板等其它消费点。
- **Builder 阶段画面质量是已知的、本期刻意接受的限制**——不得在实施过程中擅自切换模型（不接 Claude API）或大幅偏离本计划给出的提示词试图"修好"这个问题。
- **`videoProductionQueue` 并发度为 1**（`new Worker(..., { connection: redis, concurrency: 1 })`），不做批量/并发生成。
- **磁盘产物不自动清理**——`VideoProduction.productionRoot` 下的中间文件/预览片/成片留给用户手动清理，不写自动删除逻辑。
- **手动模式（`deliveryMode` 缺省）零回归**——涉及 `stageFlowFor`/`content-detail.tsx` 的每处改动都要有一条覆盖旧行为（`deliveryMode` 未传/`undefined`）的测试。
- 每个 Task 结束后 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres + Redis 需在跑）；UI/后端集成类改动额外做一次真实手工走查；尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

## Task 1: 数据模型 + `stageFlowFor` 按 `deliveryMode` 分岔

**Files:**
- Modify: `prisma/schema.prisma`（`CockpitContent` 加 `deliveryMode String @default("manual")`；新增 `model VideoProduction`）
- Modify: `src/lib/cockpit/model.ts`（`ContentItem` 加 `deliveryMode?: 'manual' | 'ai-faceless'`）
- Modify: `src/lib/cockpit/server-store.ts`（save/load 两侧按 Task 5（六幕录制进度字段）已有的先例透传新字段）
- Modify: `src/lib/cockpit/platform-stages.ts`（`stageFlowFor`/`isStageInFlow`/`nextStageFor`/`schedulableStagesFor` 签名加可选第二参数 `deliveryMode`）
- Modify: `src/components/cockpit/content-detail.tsx`（`StageStatusPanel` 内 `stageFlowFor(item.platform)` 调用改传 `item.deliveryMode`；`StageStepper` 那处同样改传）
- Modify: `src/components/cockpit/content-detail-client.tsx`（`stageFlowFor(item.platform)` 调用改传 `item.deliveryMode`）
- Test: `tests/lib/cockpit/platform-stages.test.ts`（新增用例）

**Interfaces (Produces，Task 3/9 消费):**
```ts
// model.ts ContentItem 新增（可选，缺省=manual，零迁移）：
deliveryMode?: 'manual' | 'ai-faceless';

// platform-stages.ts 签名变化：
export function stageFlowFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[];
// deliveryMode === 'ai-faceless' 时返回 ['inbox','topic','script','editing','publishing','review']
//（跳过 recording，其余与 DEFAULT_STAGE_FLOW 顺序一致）；否则行为不变（走原有 PLATFORM_STAGE_FLOW/DEFAULT 逻辑）。
export function isStageInFlow(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): boolean;
export function nextStageFor(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): ContentStage | null;
export function schedulableStagesFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[];
```

**Prisma（新增，`prisma/schema.prisma`，`CockpitContent` 模型内紧跟 `intent` 字段之后）：**
```prisma
deliveryMode String @default("manual") // manual|ai-faceless，十五期 C
```

**新增独立模型（`CockpitContent` 模型定义之后）：**
```prisma
model VideoProduction {
  id             String   @id
  userId         String
  contentId      String
  status         String   @default("queued") // queued|directing|building|assembling|preview_ready|approved|rendering|done|failed
  srt            String
  productionRoot String
  previewPath    String?
  masterPath     String?
  errorMessage   String?
  createdAt      String
  updatedAt      String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, contentId])
}
```
同时给 `User` model 加对应的反向关系字段 `videoProductions VideoProduction[]`（照抄该文件里其它模型加反向关系的写法，比如 `cockpitContents CockpitContent[]` 那一行紧邻的位置）。

**`platform-stages.ts` 具体改法**（`isStageInFlow`/`nextStageFor`/`schedulableStagesFor` 内部调用 `stageFlowFor` 处透传 `deliveryMode`）：
```ts
export function stageFlowFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[] {
  if (deliveryMode === 'ai-faceless') return ['inbox', 'topic', 'script', 'editing', 'publishing', 'review'];
  return PLATFORM_STAGE_FLOW[platform] ?? DEFAULT_STAGE_FLOW;
}

export function isStageInFlow(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): boolean {
  if (stage === 'archived') return false;
  return stageFlowFor(platform, deliveryMode).includes(stage as WorkStage);
}

export function nextStageFor(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): ContentStage | null {
  const flow = stageFlowFor(platform, deliveryMode);
  if (isStageInFlow(platform, stage, deliveryMode)) {
    const idx = flow.indexOf(stage as WorkStage);
    return idx === flow.length - 1 ? null : flow[idx + 1];
  }
  const pos = CONTENT_STAGES.indexOf(stage);
  for (let i = pos + 1; i < CONTENT_STAGES.length; i += 1) {
    const candidate = CONTENT_STAGES[i];
    if (isStageInFlow(platform, candidate, deliveryMode)) return candidate;
  }
  return null;
}

export function schedulableStagesFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[] {
  const flow = stageFlowFor(platform, deliveryMode);
  return SCHEDULABLE_STAGES.filter((stage) => flow.includes(stage));
}
```

**`content-detail.tsx`/`content-detail-client.tsx` 改法**：把两处 `stageFlowFor(item.platform)` 分别改成 `stageFlowFor(item.platform, item.deliveryMode)`——**只改这两行调用参数，函数体其余逻辑不动**（这两处都在已有的、"不新增大改"的小函数内，改动是单行参数追加，不涉及第一版计划里 `content-detail.tsx` 的"700 行保护区"）。

**Test（`tests/lib/cockpit/platform-stages.test.ts` 新增 describe 块）：**
- `stageFlowFor('douyin', 'ai-faceless')` → `['inbox','topic','script','editing','publishing','review']`（6 项，无 recording）
- `stageFlowFor('douyin', 'manual')` 与 `stageFlowFor('douyin')`（不传）结果一致，等于原 `DEFAULT_STAGE_FLOW`（**这条是"手动模式零回归"的关键断言**）
- `stageFlowFor('douyin')`（完全不传第二参数）与上一条一样，验证向后兼容旧调用签名
- `isStageInFlow('douyin', 'recording', 'ai-faceless')` → `false`；`isStageInFlow('douyin', 'recording')`（manual）→ `true`
- `nextStageFor('douyin', 'script', 'ai-faceless')` → `'editing'`（跳过 recording，验证跳阶段逻辑）；`nextStageFor('douyin', 'script')`（manual）→ `'recording'`（回归旧行为）
- `schedulableStagesFor('douyin', 'ai-faceless')` 不含 `'recording'`

- [ ] Step 1: TDD（先写上述测试，跑失败，再改 `platform-stages.ts`）
- [ ] Step 2: `prisma/schema.prisma` 加字段/新模型，`npm run db:push`
- [ ] Step 3: `model.ts` 加 `deliveryMode` 字段；`server-store.ts` save/load 两侧透传（load 侧走既有 `...rest` spread 自动带过，save 侧 `data` 对象里加 `deliveryMode: item.deliveryMode ?? 'manual'` 一行，紧邻 `intent: item.intent,` 那行）
- [ ] Step 4: `content-detail.tsx`/`content-detail-client.tsx` 两处调用改传 `item.deliveryMode`
- [ ] Step 5: `npm run typecheck && npm run test` 全绿；commit `feat(cockpit): deliveryMode 字段 + 阶段流按 AI 自动生成分岔`

---

## Task 2: SRT 合成纯函数

**Files:**
- Create: `src/lib/video-production/srt-synthesis.ts`
- Test: `tests/lib/video-production/srt-synthesis.test.ts`

**Interfaces (Produces，Task 6 消费):**
```ts
import type { ScriptAct } from '@/lib/script/six-act';

export function synthesizeSrtFromSixActScript(acts: ScriptAct[]): string;
// 逐幕处理：narration 按 /[。！？]/ 切句（保留标点，过滤空句）；
// 每句时长 = act.targetSec * (该句字符数 / 全幕句子字符总数)，四舍五入到毫秒；
// 累计维护全片时间轴游标（从 0 开始，按幕顺序、幕内按句顺序推进）；
// 输出标准 SRT：每条 `序号\nHH:MM:SS,mmm --> HH:MM:SS,mmm\n文本\n\n`（末尾空行分隔）。
// 边界：一幕只有一句 → 该句独占整幕 targetSec；一幕 narration 为空/切不出句子 → 该幕跳过整段时长
// 前进游标但不产生 SRT 条目（游标仍要往后移 targetSec，避免后续幕时间戳整体提前）。
```

**Test:**
- 单幕单句：narration="这是唯一一句。"，targetSec=10 → 1 条 SRT，`00:00:00,000 --> 00:00:10,000`
- 单幕多句按字数占比分配：narration="短句。这是一个明显更长一些的句子。"，targetSec=9 → 2 条，时长比例与字符数比例吻合（断言两条的时长之和=9000ms，且长句时长>短句时长）
- 多幕累计：两幕各 targetSec=5，第二幕第一条 SRT 的 start time = 5000ms（验证游标跨幕累加）
- 空 narration 幕：不产生 SRT 条目，但后续幕的时间戳仍从"空幕结束"算起（游标正确前进）
- 六幕全部处理：传入 6 幕的完整 `ScriptAct[]`（复用 Task 1/six-act.ts 已有的测试 fixture 风格构造），断言产出条目数与总时长（最后一条的 end time）等于 6 幕 targetSec 之和
- 序号从 1 开始连续递增，不因空幕跳号

- [ ] Step 1: TDD；commit `feat(video-production): 六幕脚本合成 SRT 纯函数`

---

## Task 3: 生成入口 UI（脚本步骤新增"AI 自动生成"选择）

**Files:**
- Modify: `src/components/cockpit/content-detail.tsx`（`script` tab 内容，六幕稿生成成功后新增一处选择控件）
- Test: 手工走查（UI-only，本仓无组件渲染测试基建，同十四期先例）

**Interfaces:** Consumes Task 1 的 `deliveryMode` 字段与 `update` 回调（已有 prop，`update(patch: Partial<ContentItem>)`）。

**Step 1：** 在 `content-detail.tsx` 的 `script` tab 内容里，`sixActScript` 非空时（即六幕稿已生成，紧邻 `<SixActPanel .../>` 之后）新增：
```tsx
{sixActScript ? <div className="delivery-mode-picker">
  <span>交付方式</span>
  <div className="delivery-mode-options">
    <button type="button" className={item.deliveryMode !== 'ai-faceless' ? 'active' : ''} onClick={() => update({ deliveryMode: 'manual' })}>手动拍剪</button>
    <button type="button" className={item.deliveryMode === 'ai-faceless' ? 'active' : ''} onClick={() => update({ deliveryMode: 'ai-faceless' })}>AI 自动生成无人出镜成片</button>
  </div>
  {item.deliveryMode === 'ai-faceless' ? <small className="field-hint">选择后「录制」步骤会跳过，「剪辑」步骤会变成「生成成片」——由 AI 自动产出无人出镜视频。</small> : null}
</div> : null}
```
（`delivery-mode-picker` 紧跟在 §T5（Task 5 of 十四期计划）加的 `SixActPanel` 渲染之后，具体插入点参照当前文件里 `sixActScript ? <SixActPanel .../> : sections ? ...` 那个三元表达式所在的 `script` tab 渲染块，插在同一个 `if (activeTab === "script")` 分支内、`SixActPanel` 渲染语句之后。）

- [ ] Step 2: `npm run typecheck && npm run test` 全绿
- [ ] Step 3: `npm run dev` 手工走查：打开一条已生成六幕脚本的内容，切到"脚本"步骤，看到交付方式选择器；点"AI 自动生成"后步骤条应该少了"录制"节点、"剪辑"节点标签变化（这条断言依赖 Task 9 才会真正生效——本 Task 先确认字段写入正确、步骤条节点数量按 Task 1 的分岔逻辑变化，标签文案改造是 Task 9 的范围，这里不强求）
- [ ] Step 4: commit `feat(cockpit): 六幕脚本页新增 AI 自动生成交付方式选择`

---

## Task 4: Director 阶段 DeepSeek 集成模块

**Files:**
- Create: `src/lib/video-production/director-prompt.ts`
- Test: `tests/lib/video-production/director-prompt.test.ts`

**Interfaces (Produces，Task 7 消费):**
```ts
import { z } from 'zod';

export const ShotSchema = z.object({
  shotId: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  claim: z.string().min(1),
  visualJob: z.string().min(1),
  beats: z.array(z.object({
    visibleState: z.string().min(1),
    development: z.string().min(1),
  })).min(2).max(8),
});
export type Shot = z.infer<typeof ShotSchema>;

export const DirectorResponseSchema = z.object({
  concept: z.string().min(1),          // 一句话视觉概念
  palette: z.array(z.string()).min(3).max(8), // 十六进制色值
  shots: z.array(ShotSchema).min(1),
});
export type DirectorResponse = z.infer<typeof DirectorResponseSchema>;

export const DIRECTOR = {
  buildSystemPrompt(): string;
  buildUserMessage(srt: string): ContentPart[]; // ContentPart 来自 @/lib/llm/vision
  responseSchema: DirectorResponseSchema,
};
```

**`buildSystemPrompt` 具体内容**（提炼自 `~/.claude/skills/broll-director/SKILL.md` 的核心规则，2026-08-17 会话已用真实 key 验证过等价版本可行，本期额外加"从简"要求）：
```ts
buildSystemPrompt(): string {
  return `你是一个 B-roll 视频的"导演"，只负责影片的意义和视觉方向。

规则：
- 用 SRT 的整数毫秒作为时间真相，覆盖从 0 到最后一句结束。
- 把表达同一个意思的字幕行合并成一个镜头，在语义转折处切镜，不要机械按字幕行切分。
- 单个镜头不超过 40000 毫秒。
- 每个镜头要写清楚：观众理解到的主张(claim)、这个画面要完成的视觉任务(visualJob，如 clarify/reveal/compare/prove)、2-6 个"微节拍"(beats，每个节拍要说清楚画面变成了什么样(visibleState)以及这个变化本身是什么(development))。
- 第一版要求构图从简：优先保证时长覆盖完整、字幕/文字清晰可读，不追求视觉丰富度和复杂运镜——用简单的文字卡片+基础过渡即可，不要设计复杂的隐喻或多层构图。
- 统一的调色板(palette)只给 3-8 个十六进制色值，覆盖全片使用。

只输出 JSON，不要 markdown 代码块标记，不要解释文字。字段：concept(一句话视觉概念)、palette(色值数组)、shots(镜头数组，每个镜头含 shotId/startMs/endMs/claim/visualJob/beats)。`;
},
```

**`buildUserMessage` 具体内容**：
```ts
buildUserMessage(srt: string): ContentPart[] {
  return [{ type: 'text', text: `完整 SRT 字幕：\n\n${srt}\n\n请给出完整的分镜方案。` }];
},
```

**Test（`tests/lib/video-production/director-prompt.test.ts`）：**
- `buildSystemPrompt()` 含关键词"导演"、"microbeats"相关中文提示（"微节拍"）、"从简"相关字样
- `buildUserMessage(srt)` 返回的 `parts[0].text` 包含传入的 SRT 原文
- `DirectorResponseSchema` 正例：一个含 2 个镜头、每镜头 3 个 beats 的合法对象通过校验
- `DirectorResponseSchema` 反例：镜头缺 `claim` 字段被拒；`beats` 只有 1 个被拒（min 2）；`shots` 空数组被拒（min 1）
- `ShotSchema` 单独测试：`startMs`/`endMs` 传负数被拒

- [ ] Step 1: TDD；commit `feat(video-production): 导演阶段提示词 + 响应 schema`

---

## Task 5: Builder 阶段 DeepSeek 集成模块

**Files:**
- Create: `src/lib/video-production/builder-prompt.ts`
- Test: `tests/lib/video-production/builder-prompt.test.ts`

**Interfaces (Produces，Task 7 消费):**
```ts
import { z } from 'zod';
import type { Shot } from './director-prompt';

export const BuilderResponseSchema = z.object({
  html: z.string().min(1),
});
export type BuilderResponse = z.infer<typeof BuilderResponseSchema>;

export const BUILDER = {
  buildSystemPrompt(palette: string[]): string;
  buildUserMessage(shot: Shot): ContentPart[];
  responseSchema: BuilderResponseSchema,
};
```

**`buildSystemPrompt` 具体内容**（提炼自 `~/.claude/skills/broll-master-build/SKILL.md`，契约与 2026-08-17 验证时一致——暴露可 seek 的暂停态 GSAP 时间线）：
```ts
buildSystemPrompt(palette: string[]): string {
  return `你是一个"构建者"，用 HTML + GSAP 把一个镜头方案实现成一段可寻址、可确定性渲染的动画源码。不做创意决策，只忠实实现给定的镜头。

技术契约（必须严格遵守，渲染工具依赖这个契约来截帧）：
- 输出一个完整、自包含的单个 HTML 文件。
- 画布尺寸固定 1920x1080。
- 引入 <script src="gsap.min.js"></script>（本地文件已提供，不要用 CDN 或其它 <script src> 引用）。
- 用一个暂停态（paused: true）的 GSAP 主时间线，挂到 window.__timelines["shot"] 上，供外部脚本调用 tl.seek(seconds) 跳到任意时间点截帧。时间线总时长要覆盖这个镜头的完整时长（毫秒转秒）。
- 不要用 setTimeout/requestAnimationFrame 自驱动播放，画面状态必须完全由 GSAP timeline 的 seek 值决定。
- 中文用系统默认无衬线字体即可（不需要真实挂字体文件）。
- 严格使用给定调色板：${palette.join(', ')}，不要发明新颜色。
- 第一版构图从简：文字卡片+简单几何图形+基础过渡（淡入淡出/位移）即可，不需要复杂运镜或隐喻。

只输出这一个 HTML 文件的完整内容，不要输出任何解释文字、不要用 markdown 代码块包裹，直接从 <!DOCTYPE html> 开始到 </html> 结束。`;
},
```

**`buildUserMessage` 具体内容**：
```ts
buildUserMessage(shot: Shot): ContentPart[] {
  const beatsText = shot.beats.map((b, i) => `${i + 1}. 画面变成: ${b.visibleState}；变化: ${b.development}`).join('\n');
  return [{
    type: 'text',
    text: `实现这个镜头（时长 ${(shot.endMs - shot.startMs) / 1000} 秒，时间线 id 用 "shot"）：\n\n主张: ${shot.claim}\n视觉任务: ${shot.visualJob}\n\n微节拍：\n${beatsText}\n\n从 0 秒开始，前面没有任何画面。`,
  }];
},
```

**Test（`tests/lib/video-production/builder-prompt.test.ts`）：**
- `buildSystemPrompt(['#111','#eee','#f80'])` 返回的字符串包含全部三个颜色值
- `buildSystemPrompt` 含"window.__timelines"关键字符串（验证契约文本没有被误改）
- `buildUserMessage(shot)` 返回的 `text` 含镜头的 `claim` 原文、含正确计算出的秒数（`(endMs-startMs)/1000`）
- `buildUserMessage` 对多个 beats 的镜头，每个 beat 的 `visibleState`/`development` 都出现在文本里
- `BuilderResponseSchema` 正例：`{html: "<!DOCTYPE html>..."}` 通过；反例：`html` 空字符串被拒，`html` 字段缺失被拒

- [ ] Step 1: TDD；commit `feat(video-production): 构建者阶段提示词 + 响应 schema`

---

## Task 6: 无头浏览器逐帧渲染 + ffmpeg 编码/拼接

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`（新增 `buildEncodeFramesArgs`/`encodeFramesToClip`、`buildConcatArgs`/`concatClips` 四个导出，紧跟现有 `extractSingleFrame` 之后，同一文件、同一 `execFileAsync` 模式）
- Create: `src/lib/video-production/shot-renderer.ts`
- Test: `tests/lib/video/ffmpeg.test.ts`（新增用例，同一文件追加）、`tests/lib/video-production/shot-renderer.test.ts`

**Interfaces (Produces，Task 7 消费):**
```ts
// src/lib/video/ffmpeg.ts 新增（照抄现有 buildExtractFramesArgs 的参数对象风格）：
export interface EncodeFramesOpts {
  framesDir: string;   // 帧图片所在目录，文件名形如 frame_%04d.png（渲染阶段按此命名）
  fps: number;
  outputPath: string;
}
export function buildEncodeFramesArgs(opts: EncodeFramesOpts): string[];
// ffmpeg -y -framerate {fps} -i {framesDir}/frame_%04d.png -pix_fmt yuv420p {outputPath}
export async function encodeFramesToClip(opts: EncodeFramesOpts): Promise<void>;

export interface ConcatClipsOpts {
  clipPaths: string[]; // 有序，按镜头顺序
  outputPath: string;
  concatListPath: string; // ffmpeg concat demuxer 需要的临时列表文件路径
}
export function buildConcatArgs(opts: ConcatClipsOpts): string[];
// ffmpeg -y -f concat -safe 0 -i {concatListPath} -c copy {outputPath}
export async function concatClips(opts: ConcatClipsOpts): Promise<void>;
// 执行前需要把 clipPaths 逐行写成 "file '{绝对路径}'" 格式写入 concatListPath（-safe 0 允许绝对路径），
// 函数内部负责写这个临时列表文件，调用方不需要自己拼。
```

```ts
// src/lib/video-production/shot-renderer.ts
export interface RenderShotOpts {
  html: string;         // Builder 阶段产出的完整 HTML
  durationMs: number;
  fps: number;
  workDir: string;       // 该镜头的工作目录，函数内部会建 frames/ 子目录并写 index.html
  outputClipPath: string;
}
export async function renderShotToClip(opts: RenderShotOpts): Promise<void>;
// 1. 把 opts.html 写入 workDir/index.html，把项目里已有的 gsap.min.js 复制到 workDir/gsap.min.js
//    (gsap.min.js 来源：2026-08-17 会话验证时从 erduo 技能的某次真实产物里取用过一份，
//    实施时从 ~/.claude/skills/erduo-broll-loop-engineering 关联的任意历史产物目录里找一份
//    gsap.min.js 复制进本仓 src/lib/video-production/assets/gsap.min.js 作为固定资产，
//    renderShotToClip 从这个固定路径复制，不依赖会话历史文件是否还在)
// 2. playwright-core 启动 chromium（executablePath 用 doctor.ts 风格的检测：优先读
//    PLAYWRIGHT_CHROMIUM_PATH 环境变量，否则在 ~/Library/Caches/ms-playwright/ 下找最新的
//    chromium-* 目录里的可执行文件——2026-08-17 会话验证时用的具体路径版本号可能已变化，
//    实施时不要硬编码那次验证用的具体版本号路径）。
// 3. viewport 设为 1920x1080，goto file://{workDir}/index.html。
// 4. 按 fps 计算总帧数 = Math.ceil(durationMs / 1000 * fps)，逐帧算 seek 秒数
//    (frameIndex / fps)，调用 page.evaluate 执行 window.__timelines['shot'].seek(sec)，
//    截图存到 workDir/frames/frame_{补零4位}.png。
// 5. browser.close()。
// 6. 调用 encodeFramesToClip({ framesDir: workDir/frames, fps, outputPath: opts.outputClipPath })。
// 7. 任何一步失败都要抛出真实错误信息（不吞异常），调用方（worker）负责落 VideoProduction.errorMessage。
```

**Test（`tests/lib/video/ffmpeg.test.ts` 追加）：**
- `buildEncodeFramesArgs({ framesDir: '/tmp/f', fps: 24, outputPath: '/tmp/out.mp4' })` 断言参数数组含 `-framerate`, `'24'`, `/tmp/f/frame_%04d.png`, `/tmp/out.mp4`
- `buildConcatArgs` 断言含 `-f`, `concat`, `-safe`, `'0'`, `-c`, `copy`

**Test（`tests/lib/video-production/shot-renderer.test.ts`，真实渲染，不 mock playwright——沿用 2026-08-17 会话已验证过的真实截帧手法）：**
- 用一段固定的、暂停态 GSAP 时间线的最小 HTML（3 秒，从纯色 A 淡入到纯色 B），调用 `renderShotToClip` 渲染成一个真实 mp4 文件，断言输出文件存在且 `probeVideo`（复用 `src/lib/video/ffmpeg.ts` 已有函数）读出的 `durationSec` 在 2.5-3.5 秒范围内（编码取整误差容忍）
- 这条测试真实启动 headless Chromium + 真实调 ffmpeg，运行时间会明显长于其它单元测试——若本仓 `vitest.config.ts` 有测试超时默认值，检查是否需要给这个测试文件单独加更长的 `timeout`（如 30000ms），实施时核实

- [ ] Step 1: TDD `buildEncodeFramesArgs`/`buildConcatArgs`（纯函数部分）
- [ ] Step 2: 实现 `encodeFramesToClip`/`concatClips`
- [ ] Step 3: 把一份 `gsap.min.js` 放进 `src/lib/video-production/assets/gsap.min.js`（从本机任意一次 erduo 真实产物目录复制，或从 GSAP 官方 CDN 下载一份 3.x 版本 min 文件——实施时二选一，取更省事的一种）
- [ ] Step 4: 实现 `renderShotToClip`，用固定测试 HTML 真实跑一次验证（TDD 的"真实系统测试"版本——测试本身就是集成验证，不追加额外 mock 测试）
- [ ] Step 5: `npm run typecheck && npm run test` 全绿（含新的真实渲染测试）；commit `feat(video-production): 逐镜头无头浏览器渲染 + ffmpeg 编码拼接`

---

## Task 7: BullMQ worker 串联全流程

**Files:**
- Modify: `src/jobs/queue.ts`（新增 `videoProductionQueue`）
- Create: `src/jobs/workers/video-production-worker.ts`
- Modify: `src/jobs/workers/index.ts`（注册新 worker，照抄其它 worker 的注册写法）
- Test: 无独立单元测试（这是集成任务，验证方式是 Task 10 的真实 E2E；worker 内部调用的 Director/Builder/渲染/SRT 模块各自已在 Task 2/4/5/6 有单元测试）

**Interfaces (Consumes 全部前置 Task 的产物；Produces，Task 8 消费):**
```ts
// queue.ts 新增
export const videoProductionQueue = new Queue(QUEUES.VIDEO_PRODUCTION, { connection: redis });
// QUEUES 常量对象新增一行: VIDEO_PRODUCTION: 'video-production',

// video-production-worker.ts
type JobData = { videoProductionId: string };
export function startVideoProductionWorker(): Worker<JobData>;
```

**worker 主体流程**（照抄 `content-analyze-worker.ts` 的"落库进度 + try/catch 顶层兜底"结构）：
```ts
async function handleProduce(job: Job<JobData>) {
  const { videoProductionId } = job.data;
  const vp = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
  if (!vp) throw new Error(`video production ${videoProductionId} not found`);

  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    prisma.videoProduction.update({ where: { id: videoProductionId }, data: { status, updatedAt: new Date().toISOString(), ...extra } });

  try {
    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await llm.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(),
      userMessage: DIRECTOR.buildUserMessage(vp.srt),
      responseSchema: DIRECTOR.responseSchema,
    });

    await setStatus('building');
    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const clipPaths: string[] = [];
    for (const shot of direction.shots) {
      const { result: built } = await builderLLM.callStructured({
        systemPrompt: BUILDER.buildSystemPrompt(direction.palette),
        userMessage: BUILDER.buildUserMessage(shot),
        responseSchema: BUILDER.responseSchema,
      });
      const shotWorkDir = path.join(vp.productionRoot, 'shots', shot.shotId);
      await fs.mkdir(shotWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: built.html,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档帧率，低于正式导出（Task 8 的 approve 流程会用更高 fps 重跑）
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
    }

    await setStatus('assembling');
    const previewPath = path.join(vp.productionRoot, 'preview.mp4');
    await concatClips({
      clipPaths,
      outputPath: previewPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
    });

    await setStatus('preview_ready', { previewPath });
  } catch (err) {
    await setStatus('failed', { errorMessage: err instanceof Error ? err.message : String(err) });
    throw err; // 让 BullMQ 记一次 failed job，日志可追溯
  }
}
```

**"确认导出"另开一个任务类型**（同一个 worker 文件，按 `job.name` 分流，或者更简单：同一个 `handleProduce` 加一个 `mode: 'preview'|'master'` 字段，`fps`/输出路径按 mode 取不同值——`master` 模式渲染到 `masterPath` 而不是 `previewPath`，`fps` 提到 30。实施时选后者，改动更小）：
```ts
type JobData = { videoProductionId: string; mode: 'preview' | 'master' };
```
`mode==='master'` 时：起始状态检查改成要求当前 `status==='approved'`（防止绕过预览确认直接跑正式渲染），流程与上面一致但 `fps: 30`、输出到 `masterPath`、终态是 `'done'`。

- [ ] Step 1: `queue.ts` 加 `videoProductionQueue`
- [ ] Step 2: 实现 `video-production-worker.ts`（`mode: 'preview'` 与 `mode: 'master'` 两条路径）
- [ ] Step 3: `workers/index.ts` 注册
- [ ] Step 4: `npm run typecheck && npm run test` 全绿（不新增测试，确认没有破坏现有测试）；commit `feat(video-production): BullMQ worker 串联导演/构建/渲染/拼接全流程`

---

## Task 8: API 路由（触发生成 / 轮询状态 / 确认导出 / 重试）

**Files:**
- Create: `src/app/api/v1/cockpit/video-productions/route.ts`（POST 触发新生成）
- Create: `src/app/api/v1/cockpit/video-productions/[id]/route.ts`（GET 查单条状态）
- Create: `src/app/api/v1/cockpit/video-productions/[id]/approve/route.ts`（POST 确认导出，触发 master 渲染）
- Create: `src/app/api/v1/cockpit/video-productions/latest/route.ts`（GET 按 `contentId` 查最新一条，供前端首次加载用）
- Test: `tests/api/cockpit/video-productions.test.ts`

**Interfaces:** Consumes Task 1（`ContentItem`/Prisma `VideoProduction`）、Task 2（SRT 合成）、Task 7（队列）。Produces：供 Task 9 UI 消费的 4 个接口。

**POST `/api/v1/cockpit/video-productions`**（body: `{ contentId: string }`）：
```ts
export async function POST(req: NextRequest) {
  const user = await getOrCreateDefaultUser();
  const { contentId } = await req.json();
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  if (!content || content.userId !== user.id) return fail('内容不存在', 404);
  const script = content.script as { acts?: unknown };
  if (!isSixActScript({ acts: script.acts, four_dims: (content.script as any).four_dims })) {
    return fail('需要先生成六幕脚本', 400);
  }
  const srt = synthesizeSrtFromSixActScript((script.acts as ScriptAct[]));
  const id = randomUUID().slice(0, 12);
  const productionRoot = path.join(process.env.VIDEO_PRODUCTION_ROOT || './video-productions', id);
  await fs.mkdir(productionRoot, { recursive: true });
  const vp = await prisma.videoProduction.create({
    data: { id, userId: user.id, contentId, srt, productionRoot, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
  await videoProductionQueue.add('produce', { videoProductionId: id, mode: 'preview' });
  return ok({ id: vp.id, status: vp.status });
}
```
（`isSixActScript`/`ScriptAct` 从 `@/lib/script/six-act` 导入，与十四期计划里其它路由消费这两个导出的方式一致。）

**GET `/api/v1/cockpit/video-productions/[id]`**：查单条，返回 `status`/`previewPath`/`masterPath`/`errorMessage`（归属校验：`userId !== user.id` → 404，不裸露存在性）。

**GET `/api/v1/cockpit/video-productions/latest?contentId=xxx`**：按 `contentId` 查最新一条（`orderBy: { createdAt: 'desc' }, take: 1`），供前端打开"生成成片"面板时首次加载已有进度用；查不到返回 `ok({ data: null })`（不是 404——"还没生成过"是合法状态）。

**POST `/api/v1/cockpit/video-productions/[id]/approve`**：校验 `status==='preview_ready'`（否则 400），更新为 `'approved'`，入队 `mode:'master'` 任务。

**Test（`tests/api/cockpit/video-productions.test.ts`，照抄现有 API 测试的 mocked-Prisma + mocked-Queue 风格）：**
- POST 无六幕脚本的内容 → 400
- POST 有六幕脚本 → 201/200，`prismaMock.videoProduction.create` 被调用，`videoProductionQueue.add` 被调用且 `mode:'preview'`
- POST 内容属于别的用户 → 404
- GET `[id]` 查到别人的记录 → 404
- GET `latest` 查无记录 → `ok({data: null})` 不是 404
- POST `approve` 在 `status!=='preview_ready'` 时 → 400，不入队
- POST `approve` 在 `status==='preview_ready'` 时 → 200，状态转 `'approved'`，`videoProductionQueue.add` 被调用且 `mode:'master'`

- [ ] Step 1: TDD 四个路由；commit `feat(video-production): 生成/轮询/确认导出 API 路由`

---

## Task 9: UI 面板（"生成成片"步骤内容）

**Files:**
- Modify: `src/components/cockpit/content-detail.tsx`（`editing` tab 内容整体按 `item.deliveryMode==='ai-faceless'` 再加一层分岔；`StageStepper`/`StageStatusPanel` 的展示文案局部覆盖"生成成片"）
- Create: `src/components/cockpit/video-production-panel.tsx`
- Test: 手工走查（UI-only）

**Interfaces:** Consumes Task 8 的 4 个 API。

**Step 1：** 新建 `src/components/cockpit/video-production-panel.tsx`：
```tsx
"use client";
import { useEffect, useState } from "react";

interface VideoProductionState {
  id: string;
  status: string;
  previewPath: string | null;
  masterPath: string | null;
  errorMessage: string | null;
}

export function VideoProductionPanel({ contentId }: { contentId: string }) {
  const [vp, setVp] = useState<VideoProductionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/cockpit/video-productions/latest?contentId=${contentId}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled && json.success) setVp(json.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contentId]);

  useEffect(() => {
    if (!vp || ['done', 'failed'].includes(vp.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/cockpit/video-productions/${vp.id}`);
      const json = await res.json();
      if (json.success) setVp(json.data);
    }, 3000);
    return () => clearInterval(timer);
  }, [vp?.id, vp?.status]);

  async function start() {
    setLoading(true);
    const res = await fetch('/api/v1/cockpit/video-productions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentId }),
    });
    const json = await res.json();
    if (json.success) setVp({ id: json.data.id, status: json.data.status, previewPath: null, masterPath: null, errorMessage: null });
    setLoading(false);
  }

  async function approve() {
    if (!vp) return;
    await fetch(`/api/v1/cockpit/video-productions/${vp.id}/approve`, { method: 'POST' });
    setVp({ ...vp, status: 'approved' });
  }

  const STATUS_LABEL: Record<string, string> = {
    queued: '排队中', directing: '构思分镜中', building: '搭建画面中',
    assembling: '拼接预览中', preview_ready: '预览就绪', approved: '已确认，渲染正式成片中',
    rendering: '渲染正式成片中', done: '已完成', failed: '生成失败',
  };

  if (loading) return <p className="muted">加载中…</p>;
  if (!vp) return <button type="button" className="primary-button" onClick={start}>开始生成</button>;

  return <div className="video-production-panel">
    <div className="video-production-status"><strong>{STATUS_LABEL[vp.status] ?? vp.status}</strong></div>
    {vp.status === 'preview_ready' && vp.previewPath ? <>
      <video src={vp.previewPath} controls className="video-production-preview" />
      <div className="video-production-actions">
        <button type="button" className="primary-button" onClick={approve}>确认导出</button>
        <button type="button" className="secondary-button" onClick={start}>重新生成</button>
      </div>
    </> : null}
    {vp.status === 'done' && vp.masterPath ? <a className="primary-button" href={vp.masterPath} download>下载成片</a> : null}
    {vp.status === 'failed' ? <>
      <p className="field-hint">{vp.errorMessage}</p>
      <button type="button" className="secondary-button" onClick={start}>重试</button>
    </> : null}
  </div>;
}
```

- [ ] Step 2: 在 `content-detail.tsx` 的 `editing` tab 分支最外层加一层判别：
  ```tsx
  {activeTab === "editing" ? (item.deliveryMode === 'ai-faceless'
    ? <div className="drawer-section"><VideoProductionPanel contentId={item.id} /></div>
    : <div className="drawer-section">{/* 原有空白备注框+打勾清单，逐字不动 */}</div>
  ) : null}
  ```
- [ ] Step 3: `StageStepper`/`StageStatusPanel` 渲染节点标签处，`item.deliveryMode==='ai-faceless' && stage==='editing'` 时局部覆盖显示"生成成片"（不改 `stageLabelFor` 本身，只在这两处调用点用三元表达式覆盖显示文案）
- [ ] Step 4: `npm run typecheck && npm run test` 全绿
- [ ] Step 5: `npm run dev` 手工走查：选了 AI 自动生成的内容，切到"生成成片"步骤，点"开始生成"，观察状态轮询变化（可以先用较短的测试脚本走一遍，不必等真实几分钟的完整生成——Task 10 会做完整真实走查）
- [ ] Step 6: commit `feat(cockpit): 生成成片面板 UI`

---

## Task 10: 收尾 — 真实 E2E + README

**Files:**
- README.md（十五期段落）
- 无代码改动

**真实 E2E（真花 DeepSeek key 额度 + 真实本机渲染，预计几分钟/条）：**
①打开一条已有六幕脚本的内容，选"AI 自动生成无人出镜成片" ②点"开始生成"，观察 `VideoProduction.status` 真实走完 `queued→directing→building→assembling→preview_ready` 全部状态（不 mock 任何一步）③预览片能在浏览器里播放，时长与 SRT 总时长大致吻合 ④点"确认导出"，等正式渲染完成，成片可下载播放 ⑤打开一条手动模式的内容，确认录制/剪辑步骤完全不受影响（零回归验证）⑥`typecheck+test+build` 全绿。

- [ ] Step 1: 真实 E2E 走一遍，记录实际观察（分镜数量、渲染耗时、产物文件大小等），过程中发现的真 bug 按十四期计划的先例处理（单独 fix commit，不与文档改动混在一起）
- [ ] Step 2: README 补十五期段落（无人出镜自动生成的使用方式、已知限制——画面质量偏弱/只支持无人出镜/本机跑）
- [ ] Step 3: `npm run typecheck && npm run test && npm run build` 全绿；commit `docs(video-production): 十五期第一阶段收尾, README 对齐`

---

## Self-Review 记录

- Spec 覆盖：§0 决策表全部体现在 Global Constraints ✓；§1 数据模型 Task 1 ✓；§2 阶段流（含两轮规划期修正：看板不动、`stageLabelFor` 不改签名）Task 1/9 ✓；§3 生成入口 Task 3 ✓；§4 SRT 合成 Task 2 ✓；§5 后端执行架构（含规划期修正：不复用技能重型脚本，自建渲染模块）Task 4/5/6/7 ✓；§6 UI Task 9 ✓；§7 YAGNI 未越界（未做 talking-head、未接 Claude API、未做批量并发、未做自动重试/自动清理）✓；§8 风险——`stageFlowFor` 调用点核实 Task 1 已逐个列出、Builder 质量限制写进 Global Constraints、长任务失败处理 Task 7 每步 try/catch、磁盘清理 Global Constraints 明确不做、SRT 边界测试 Task 2 覆盖 ✓。
- 类型一致性：`deliveryMode` 类型 `'manual'|'ai-faceless'` 在 model.ts/platform-stages.ts/content-detail.tsx/API 路由间一致；`Shot`/`DirectorResponse` Task 4 定义，Task 5（`BUILDER.buildUserMessage(shot: Shot)`）/Task 7（worker 消费 `direction.shots`）复用同一类型；`renderShotToClip`/`encodeFramesToClip`/`concatClips` Task 6 定义，Task 7 直接调用，参数名/类型对齐。
- 已知不确定点（实施核实记账本）：`gsap.min.js` 固定资产文件的具体获取方式（本机历史产物 vs 官方下载，Task 6 Step 3 已给两个选项）；`playwright-core` 的 chromium 可执行文件路径检测逻辑（Task 6 明确不要硬编码 2026-08-17 会话验证时用过的具体版本号路径，需要实施时写一个探测逻辑或读环境变量）；`vitest.config.ts` 对长耗时真实渲染测试的默认超时是否够用（Task 6 Step 5 标注需要核实）；Director/Builder 提示词的实际生成质量随 DeepSeek 模型更新可能漂移，本计划给出的提示词是 2026-08-17 会话验证时的版本，不保证未来某次 DeepSeek 更新后效果完全一致。
