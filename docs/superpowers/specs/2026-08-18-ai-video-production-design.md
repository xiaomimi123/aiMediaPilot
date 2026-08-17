# 无人出镜 AI 自动生成成片（十五期 C · 第一阶段）

**日期:** 2026-08-18
**背景:** 用户核心诉求——「录制/剪辑不该是我自己干的活，应该由工具自动生成」。已确认存在两种目标形态：①无人出镜（AI 全自动，从文案直接产出成片）②真人出镜（用户上传口播视频，工具匹配画面）。本期只做①，②留给下一阶段（需要新接语音识别对轨能力）。

技术路线已在 2026-08-17 会话里用真实 DeepSeek key 做过验证，结论详见项目记忆 `project-broll-engine-findings`：候选引擎是本机已装好的 Claude 技能 `erduo-broll-loop-engineering`（用户已用它跑出过真实 4K 成片）；导演阶段（写叙事/分镜方案）复刻到 DeepSeek 可行，质量接近；Builder 阶段（写画面/动画源码）DeepSeek 技术上能跑但创意执行明显偏弱，一轮文字反馈迭代补不齐——**本期决定接受这个已知限制，不接 Claude API，画面质量优化留后续**。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 先做哪种形态 | 无人出镜 faceless；真人出镜 talking-head 留待下一阶段 |
| Builder 阶段模型 | 继续用 DeepSeek，接受现阶段画面创意执行力偏弱，不接 Claude API |
| 部署环境 | 只在用户本机跑（`npm run dev` + `npm run worker:dev`），直接复用本机已装好的无头 Chromium + ffmpeg 工具链，不考虑服务器部署 |
| 接入现有内容流程 | 新增 `ContentItem.deliveryMode` 字段；选了无人出镜的内容用一条新阶段流替代录制+剪辑 |
| 第一版目标 | 先跑通端到端骨架（真实调 DeepSeek + 真实渲染 + 真实产出预览片/成片），画面构图故意从简，不在这版死磕视觉丰富度 |

## 1. 数据模型

**`ContentItem` 新增字段**（`src/lib/cockpit/model.ts`，可选，缺省=手动模式，零迁移）：
```ts
deliveryMode?: 'manual' | 'ai-faceless';
```

**新增 Prisma 模型 `VideoProduction`**（对标 `ScriptDraft` 的先例——独立表，`contentId` 关联，不塞进 `CockpitContent` 本身）：
```prisma
model VideoProduction {
  id            String   @id
  userId        String
  contentId     String   // → CockpitContent.id
  status        String   @default("queued") // queued|directing|building|assembling|preview_ready|approved|rendering|done|failed
  srt           String   // 合成的 SRT 全文
  productionRoot String  // 本机工作目录绝对路径 (production-profile.json/narrative-envelope.json 等产物所在)
  previewPath   String?  // 低成本预览片相对路径
  masterPath    String?  // 正式成片相对路径
  errorMessage  String?
  createdAt     String
  updatedAt     String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, contentId])
}
```

一条 `ContentItem` 允许有多条 `VideoProduction` 历史记录（重新生成不覆盖旧记录，取最新一条展示），与 `ScriptDraft` 的"一篇内容多次生成"模式一致。

## 2. 阶段流变更（不新增 ContentStage 枚举值）

**关键设计取舍**：不新增第 8 个 `ContentStage` 值（如 `"producing"`）——那会牵动 `STAGE_LABELS`/`NEXT_ACTIONS`/`CONTENT_STAGES`/看板列/`Prisma.stage` 默认值等一整圈现有代码，改动面和小红书当年"录制/剪辑对它是死阶段"的场景本质相同。**沿用 `platform-stages.ts` 已有的先例**（`src/lib/cockpit/platform-stages.ts:7-8` 注释："配图并入「文案」阶段的抽屉, 不新增阶段值"）：`deliveryMode:'ai-faceless'` 的内容，阶段流跳过 `recording`（`isStageInFlow` 返回 false，看板/步骤条都不显示这一列/节点），**复用 `editing` 这个既有阶段值**，但它的详情页渲染内容整体替换成"生成成片"面板（而不是六幕指导清单或空白备注框）。

`stageFlowFor` 签名扩展为同时按 `deliveryMode` 分岔（`platform` 不变仍是第一参数，`deliveryMode` 新增可选第二参数）：
```ts
export function stageFlowFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[] {
  if (deliveryMode === 'ai-faceless') return ['inbox', 'topic', 'script', 'editing', 'publishing', 'review'];
  return PLATFORM_STAGE_FLOW[platform] ?? DEFAULT_STAGE_FLOW;
}
```
所有调用点（`isStageInFlow`/`nextActionFor`/`stageLabelFor`/内容详情页步骤条/看板列生成）都要把 `item.deliveryMode` 一并传入——**这是本期改动面最大的一处，需要逐个调用点核实**（详见 §7 风险）。

`editing` 阶段在无人出镜模式下的 `stageLabelFor` 展示文案改成"生成成片"（`src/lib/cockpit/platform-stages.ts` 的 `stageLabelFor` 已有 xiaohongshu 的"文案"覆写先例，同款再加一条分支）。

**手动模式（`deliveryMode` 缺省/`'manual'`）完全不受影响**——`stageFlowFor` 第二参数不传等价于 `undefined`，走原有分支，零改动。

## 3. 生成入口

「脚本」步骤（`content-detail.tsx` 的 `script` tab）生成六幕脚本成功后，新增一个选择："手动拍剪" / "AI 自动生成无人出镜成片"——选后者即把 `item.deliveryMode` 写成 `'ai-faceless'`，内容详情页步骤条立即按新阶段流重排（`recording` 节点消失，`editing` 节点标签变"生成成片"）。已经选过 `ai-faceless` 的内容也可以在这一步改回"手动"，`deliveryMode` 是可逆的普通字段，不是一次性开关。

## 4. SRT 合成（无需真人录音）

无人出镜模式的 SRT 直接从六幕脚本合成，不需要语音识别：

```ts
// src/lib/script/srt-synthesis.ts（新建）
export function synthesizeSrtFromSixActScript(acts: ScriptAct[]): string;
```
逐幕处理：每幕的 `targetSec` 是这一幕的总时长预算；`narration` 按句号/问号/感叹号切句，每句时长 = `targetSec × (该句字数 / 全幕字数)`（按字数占比分配，不是均分——避免长句被压缩成读不完的语速）；累计到全片时间轴，输出标准 SRT 格式（序号+`HH:MM:SS,mmm --> HH:MM:SS,mmm`+文本）。这与十三期六幕改造时讨论过的"逐幕时长预算"是同一套时长模型，直接复用 `six-act.ts` 的 `ScriptAct.targetSec`，不用重新设计。

## 5. 后端执行架构

**新增 BullMQ 队列**：`src/jobs/queue.ts` 加 `export const videoProductionQueue = new Queue(QUEUES.VIDEO_PRODUCTION, { connection: redis });`（照抄 `radarQueue`/`retroQueue` 的写法）。

**新增 worker**：`src/jobs/workers/video-production-worker.ts`（注册进 `src/jobs/workers/index.ts`，随 `npm run worker:dev` 一起跑），任务体依次执行，每步更新 `VideoProduction.status` 并落库中间产物路径：

1. **`queued → directing`**：调用 DeepSeek（`deepseek-reasoner`，已验证可行），提示词照抄 2026-08-17 会话验证过的 Director 阶段提示词（系统提示词内容见项目记忆 `project-broll-engine-findings` 关联的会话记录，或重新读 `~/.claude/skills/broll-director/SKILL.md` 提炼），输入 §4 合成的 SRT，产出叙事纲要/视觉系统/逐镜头 Recipe（JSON/markdown 混合，参照 `erduo-broll-loop-engineering` 技能 `01-director/` 产物结构）。
2. **`directing → building`**：调用该技能自带的确定性脚本 `plan-runtime.mjs`（`~/.claude/skills/erduo-broll-loop-engineering/scripts/`）跑运行时规划，产出每个分镜的任务包；再逐镜头调 DeepSeek（`deepseek-chat`，已验证可行但质量偏弱，第一版接受）复刻 Builder 阶段，产出 HyperFrames HTML/GSAP 源码（系统提示词照抄 2026-08-17 验证脚本里用过的版本，存档在项目记忆关联的会话记录里）。
3. **`building → assembling`**：本机无头 Chromium（`playwright-core` + 已缓存的 `chromium-1234` 版本，2026-08-17 会话已验证可用）逐镜头渲染截帧+编码，调用该技能的 `assemble-frozen-production.mjs preview` 拼出低成本预览片。
4. **`assembling → preview_ready`**：预览片路径写回 `VideoProduction.previewPath`，等待用户在前端确认。
5. **用户点"确认导出"**：状态 `preview_ready → approved → rendering`，调用 `assemble-frozen-production.mjs deliver` 跑正式全规格渲染，产出写 `masterPath`，状态转 `done`。
6. 任一步失败：状态转 `failed`，`errorMessage` 记录具体阶段+原因，不静默重试（用户在前端点"重试"手动触发，复用同一条 `VideoProduction` 记录或开新的，看实施时哪种更符合"多次生成保留历史"的既有模式）。

**第一版画面从简**：Director 提示词里明确要求"构图从简，优先保证时长覆盖/字幕清晰/无渲染报错，不追求视觉丰富度"——用简单的文字卡片+基础过渡即可，验证骨架通不通比画面好看更优先。

## 6. UI / 进度展示

「生成成片」面板（`editing` 阶段在 `deliveryMode:'ai-faceless'` 时的渲染内容，替代六幕指导清单/空白备注框）：

- 无进行中任务时：一个"开始生成"按钮。
- 有进行中任务时：阶段进度指示（对应 `VideoProduction.status` 的 6 个中间态，复用 `stage-stepper.tsx` 已有的"节点+连线"视觉语言，但这里是同一个阶段内部的子进度，不是内容详情页顶部那条大步骤条）——前端轮询 `GET` 一个新增的只读接口（如 `/api/v1/cockpit/video-productions/[contentId]/latest`）取最新状态，2-3 秒轮询一次。
- `preview_ready` 态：内嵌 `<video>` 播放器播放预览片，「确认导出」/「重新生成」两个按钮。
- `done` 态：成片下载链接 + 重新生成入口。
- `failed` 态：展示 `errorMessage`，「重试」按钮。

## 7. YAGNI（不做）

- 不做真人出镜 talking-head 模式（需要语音识别对轨，留下一阶段）。
- 不接 Claude API 做 Builder 阶段。
- 不追求画面视觉丰富度，第一版验证管线通不通。
- 不做批量/并发生成，`videoProductionQueue` 并发度设 1，同一时间只跑一条内容。
- 不改动手动模式任何现有行为。
- 不做失败自动重试，失败态需要用户手动点重试。

## 8. 风险

| 风险 | 对策 |
|---|---|
| `stageFlowFor` 签名扩展要传 `deliveryMode`，调用点分散在看板/步骤条/发布等多处，漏传一处就会让 `ai-faceless` 内容在那一处退回按 platform 分的默认 7 阶段流（`recording` 又冒出来），复现九期"展示层收窄可见集合时写入层必须同步"的老问题 | 实施时先全仓库搜 `stageFlowFor(` 每个调用点，逐个核对是否需要传 `item.deliveryMode`，写一条覆盖每个消费点的旧模式（`deliveryMode` 缺省）回归测试 |
| DeepSeek Builder 阶段画面质量偏弱是已知的、本期刻意接受的限制，不是要在实施阶段"顺手优化掉"的 bug | 明确写进 §0 决策表和 §5，实施子代理不应擅自切换模型或大改提示词试图"修好"这个问题 |
| 后端首次跑"多阶段 AI 编排 + 真实渲染管线"的长任务，失败模式未知（DeepSeek 超时、Chromium 崩溃、ffmpeg 编码失败等） | worker 每一步都要有明确的 try/catch 落 `failed` 状态+错误信息，不吞异常；第一版不做自动重试，靠用户手动重试降低复杂度 |
| `VideoProduction` 工作目录 (`productionRoot`) 会在本机磁盘留下真实文件（分镜 JSON、渲染中间产物、预览片、成片） | 实施时确认清理策略——至少要在 spec 落地前问清楚：失败/废弃的任务要不要自动清理磁盘，还是留给用户手动清（参照 `erduo-broll-loop-engineering` 技能本身"Never overwrite"的产物管理约定） |
| SRT 合成的按字数占比分配时长，对短句/长句边界情况（如全幕只有一句超长台词）可能分配出不合理的单句时长 | `synthesizeSrtFromSixActScript` 需要单元测试覆盖：单句幕、多句幕、极短幕（`targetSec` 很小）等边界 |
