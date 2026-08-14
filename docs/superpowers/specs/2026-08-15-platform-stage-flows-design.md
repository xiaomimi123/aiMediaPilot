# 平台差异化流水线（cockpit 九期）

**日期:** 2026-08-15
**背景:** 用户指出「每个平台内的流程是不一样的，而不是统一的阶段完成状态」。现状：全站统一 8 阶段（灵感→大纲→脚本→录制→剪辑→发布→复盘→归档）继承自 vendor。七期后小红书已是纯 AI 图文产线——录制/剪辑对它是永远空走的死阶段，且定稿自动推进会把 xhs 卡推进录制这个死阶段。本期为每平台定义各自的阶段流。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 路线 | 数据层 `ContentStage` 8 阶段超集**不动**，新增「平台阶段流」视图与推进层（否决模型层重定义[迁移风险]与用户自定义模板[YAGNI]） |
| 各平台流 | 视频四平台（douyin/bilibili/x/youtube）+ 未知平台 = 现状全集；xiaohongshu = 灵感→大纲→文案(script 改标签)→发布→复盘（配图并入文案阶段的抽屉，不新增阶段值） |
| 抖音精简 | 不做——数字人未接入，录制/剪辑仍是真实工作；等数字人期一起改「成片」阶段 |
| 存量归并 | 一次性脚本：xhs 卡 stage ∈ {recording, editing} → script（宁可重走配图确保成品），dry-run + 确认执行 |

## 1. 平台阶段流层（新纯模块，唯一事实来源）

`src/lib/cockpit/platform-stages.ts`：

```ts
export const PLATFORM_STAGE_FLOW: Record<string, WorkStage[]> = {
  xiaohongshu: ['inbox', 'topic', 'script', 'publishing', 'review'],
  // 其余平台不列 —— 走 default
};
export const DEFAULT_STAGE_FLOW: WorkStage[] = WORK_STAGES;  // 现状 7 阶段
export function stageFlowFor(platform: string): WorkStage[]           // 未知平台 → DEFAULT
export function stageLabelFor(platform: string, stage: ContentStage): string
// xhs 的 script → '文案'，其余一律 STAGE_LABELS[stage]（archived 也走这里）
export function nextActionFor(platform: string, stage: ContentStage): string
// xhs 的 script → '完成文案与配图'，其余 NEXT_ACTIONS[stage]
export function nextStageFor(platform: string, stage: ContentStage): ContentStage | null
// 在该平台流内取下一个；stage 不在流内（存量脏值）→ 返回流内第一个位于其后的合法阶段（按全集顺序找），流尾 → 'archived' 之前返回 'review' 之后 null 语义同现状推进边界
export function isStageInFlow(platform: string, stage: ContentStage): boolean
export function schedulableStagesFor(platform: string): WorkStage[]   // flow ∩ SCHEDULABLE_STAGES
```

数据层 `ContentStage` 枚举、CockpitContent.stage 取值域、workspace rev 机制一概不动。

## 2. 前端消费点

- **各平台流水线视图**（三期已分屏）：看板列 = `stageFlowFor(platform)` ——小红书看板无录制/剪辑列；拖拽目标天然限于可见列。
- **内容总览**（跨平台混合视图）：保留 8 列超集不变（总览就该是超集，存量脏值卡也能显示）。
- **抽屉 tab**：按 item.platform 过滤（xhs 无 recording/editing tab；script tab 标「文案」）；tab 内文案走 `stageLabelFor`/`nextActionFor`。
- **档期**：可排阶段 = `schedulableStagesFor(platform)`；**今日推进**任务生成按平台流（不在流内的阶段不生成任务）。
- 阶段徽标、推进按钮、下一步提示统一走流层函数——**禁止新增对 STAGE_LABELS/NEXT_ACTIONS/WORK_STAGES 的平台无关直引**（既有非平台语境的直引如设置/归档统计可保留）。

## 3. 服务端推进语义

- 定稿(picked)自动推进：`script → nextStageFor(platform, 'script')`——douyin→recording（现状）、xiaohongshu→publishing（修死阶段 bug）。`src/lib/pipeline/stage.ts` 语义标注同步。
- API 不加阶段硬校验：stage 字段取值域保持超集宽松（看板过滤已天然限制；硬校验会卡住存量脏值卡，YAGNI）。

## 4. 存量归并（一次性）

`scripts/migrate-xhs-stages.ts`：查 `CockpitContent(platform='xiaohongshu', stage in ['recording','editing'])` → 归并为 `script`；默认 dry-run 打印将改动的卡（id/标题/当前阶段），加 `--apply` 才执行；执行走事务并 `bumpCockpitRev`（cockpit 服务端直写纪律）。跑一次即弃，README 不长期收录（脚本文件保留仓库内）。

## 5. 不做（YAGNI）

用户自定义阶段模板；新增阶段值（配图不独立成列）；抖音录制/剪辑合并（留数字人期）；goals/analytics 阶段统计改造（超集下继续正确）；API 阶段硬校验；老 StageEvent 历史改写。

## 6. 风险

| 风险 | 对策 |
|---|---|
| 流层遗漏消费点（某处仍显示 xhs 录制/剪辑） | 计划为每个消费点列专项走查清单；终审重点 |
| 存量脏值卡（归并后仍可能有别的平台脏值组合） | nextStageFor 对流外 stage 有明确回落语义；总览超集列兜底显示 |
| 今日推进/档期已有排期指向被移除的阶段 | 归并脚本同时清理 xhs 卡上 recording/editing 的 stageSchedule 排期（事务内）；已发生 StageEvent 历史不动 |
| 跨平台改 platform 字段的卡 | 改平台后 stage 若不在新流内：展示层回落 + 用户手动拖正；不做自动矫正（YAGNI） |

## 7. 实际实施结论（T1-T5 落地后回写，2026-08-15）

设计文档写于实施前，以下是与草稿假设有出入、或草稿未覆盖、需要落盘存档的实际决策，逐条对应 `.superpowers/sdd/2026-08-15-platform-stage-flows/task-*-report.md` 里的记录：

**(a) T2 修复轮：阶段推进平台化——Critical 教训「看板收窄后，推进仍走全集 = 卡从看板消失」**：草稿 §2 只把「今日任务生成」列为消费点（`canScheduleStage` 加 `isStageInFlow` 闸门），未预见看板列收窄本身会让阶段推进函数暴露出一个新问题。T2 首轮交付后审查复现：xhs 卡 `stage='script'` 点「完成文案」，`toggleStageEvent`/`setContentStageCompletion` 仍调用未感知平台的 `nextContentStage(stage)` 按 8 阶段全集把它推进到 `'recording'`——而 xhs 平台看板已经收窄成 5 列（不含 `recording`），卡片从平台看板上直接消失、抽屉徽标显示「录制」这个对 xhs 而言不存在的阶段。根因：**看板收窄（展示层）与阶段推进（写入层）是两套独立机制，只改一边会在写入层产出展示层接不住的值**——这条经验对本期后续所有"收窄某平台可见集合"的改动都成立，不是这一次改动特有的。修复：`workflow.ts` 的 `toggleStageEvent`/`setContentStageCompletion` 两处平台语境调用点全部改用 `nextStageFor(content.platform, stage) ?? stage`（流尾停在原地，不越界）；连带修了同一条链路上 `Cockpit.tsx` 的 `toggleTodayComplete` toast 文案（同样在直接调 `nextContentStage` 拼"已完成，进入 XX"，不改会导致提示文案与实际推进结果对不上）。真机走查用 Playwright 复现"完成文案后卡片落对发布列"闭环，详见 `task-2-report.md` 修复轮记录。

**(b) `nextContentStage` 现状：仍导出，但 `src/` 内已无调用者**：修复 (a) 后 grep 确认 `workflow.ts` 内 `nextContentStage` 的两个平台语境调用点（`toggleStageEvent`/`setContentStageCompletion`）已全部换成 `nextStageFor`，`src/` 全仓库范围内不再有任何内部消费点直接依赖它的"8 阶段全集循环推进"语义。函数本身**未删除**——`tests/lib/cockpit/calculations.test.ts` 仍保留对它的独立单测（验证纯 8 阶段循环语义本身没坏），且它是从 vendor 原样移植的纯函数，删除需要额外确认没有游离引用，不在本期收尾范围内（YAGNI，留作候选清理项，参考 README §9「遗留清理候选」的既有先例）。

**(c) T4 修复轮：`CockpitStageEvent.completedAt` 区分"排期"与"历史"，归并脚本必须只清前者**：草稿 §4「清理该卡上 recording/editing 的排期」写得比较笼统，未点明 `CockpitStageEvent` 表本身没有"排期 vs 历史"两张表的物理区分——两者是同一张表按 `completedAt` 字段值区分的逻辑状态（`''` = 未完成的排期，非空 = 已完成的历史记录，`workflow.ts` 与 `picked` 路由标记"完成"都是原地 `UPDATE completedAt`、不新建行）。首轮实现的 `deleteMany` 对 `stage in [recording, editing]` 不分 `completedAt` 一律删，审查发现这会把"卡在 editing 阶段的小红书卡片几乎必然带的一条 `completedAt` 非空的 `recording` 历史"一并误删，违反简报硬约束「StageEvent 历史不动」。修复：`deleteMany` 的 `where` 加 `completedAt: ''`，只清未完成排期；真库回归验证（混合排期场景：1 条已完成 recording 历史 + 1 条未完成 editing 排期 + 1 条 script 历史对照）确认已完成历史正确保留、未完成排期正确清理。详见 `task-4-report.md` 修复轮记录。

**(d) 排期存储实况：独立表 `CockpitStageEvent`，非 `CockpitContent` 字段、非 workspace JSON blob**：草稿 §4 标注为不确定点。T4 落地时 grep `prisma/schema.prisma` + `model.ts` + `server-store.ts` 确认：`CockpitContent` 表没有任何排期相关字段；也不是 workspace 的 Json blob 一部分；实际是独立表 `CockpitStageEvent`（`id/userId/contentId/stage/plannedDate/rank/completedAt`），每张卡片每次阶段排期是该表里 `contentId` 匹配、`stage` 对应的一行或多行，`model.ts` 对应 TS 类型是 `StageEvent`（`WorkspaceState.stageEvents: StageEvent[]`）。归并脚本按此落地为 `tx.cockpitStageEvent.deleteMany({ where: { contentId, stage: { in: [...] }, completedAt: '' } })`（(c) 修复后的最终形态）。

**(e) `pipeline.tsx`/`platform.tsx` 复用关系：共用同一个 `ContentOverviewView` 组件，改造前平台页看板列其实也是 8 列超集**：另一个草稿标注的不确定点。T2 落地时确认 `platform.tsx` 内嵌 `pipeline.tsx` 导出的 `ContentOverviewView` 并传 `platformFilter`（三期先例）；改造前该组件看板列固定用 `CONTENT_STAGES`，**不区分是否带 `platformFilter`**——即九期改造前，平台流水线页展示的其实也是 8 列超集看板，只是卡片被 `platformFilter` 过滤了，列本身没有跟着收窄，这正是简报预判的"共用组件需要按超集/流两态分岔"那个缺口。落地：`pipeline.tsx` 内一处分岔 `const stages = platformFilter ? stageFlowFor(platformFilter) : CONTENT_STAGES`，总览路径（无 `platformFilter`）完全不变；`platform.tsx` 本身零改动（它不直接引用 `STAGE_LABELS`/`NEXT_ACTIONS`/`WORK_STAGES`）。

**(f) 今日任务生成的唯一权威闸门：`workflow.ts` 的 `canScheduleStage`，不是 `momentum.tsx`**：第三个不确定点。「今日任务」（`todayEntries`/`overdueEntries`）实际是 `Cockpit.tsx` 对 `state.stageEvents` 做日期过滤拼出来的展示逻辑，没有独立的"生成今日任务"函数；真正决定"一个 `WorkStage` 能不能落地成 `stageEvent`"的唯一入口是 `canScheduleStage`（`scheduleStageForDate`/`moveStageEventToDate` 最终都过这道闸）。落地点选在 `canScheduleStage` 内新增 `isStageInFlow` 校验，比在 UI 各处分别过滤更不容易漏、且可单测。

**(g) T5 E2E 收尾顺带发现并修复一处与本期设计无关的真实 bug**：走查②③（真实定稿一篇 xhs 稿 / 一篇抖音稿，确认落对看板列）时，抖音稿定稿要在 `/content/script/[id]` 深度脚本页点击标题候选触发 `PUT picked`——该页直接崩溃（`Cannot read properties of undefined (reading 'map')`）。根因与本期改动无关：`script-result.tsx` 的 `DouyinView` 组件仍在读 Phase A 时代单阶段生成留下的 legacy schema 字段 `retentionBeats[]`，而五期（2026-08-13, `script-quality`）起抖音改成两阶段研究/写作管线后，落库的 `output` 形状换成了 `{ script: { sections[] }, hooks, titles, cover }`（`script-write-douyin.ts` 的 `DouyinFullScriptSchema`）——hooks/titles/cover 字段名两种形状一致，唯独 `retentionBeats` 在新形状里根本不存在，`.map` 直接对 `undefined` 抛错。这个页面自五期上线以来对两阶段生成的抖音稿从未被任何一期的收尾 E2E 走查覆盖过（五/六期的真实验证都是在抽屉内完成，没有跳转到这个深度详情页）。修复：`DouyinView` 按 `data.retentionBeats` 是否存在分岔渲染（老稿走原表格，新稿改渲染 `script.sections[]` 逐字稿列表），不改数据形状本身，`npx tsc --noEmit`/`npm test`（106 files / 1210 passed）/`npm run build` 均过。判定为独立 bug fix，未并入本期"平台阶段流"设计范围，单独一个 fix commit。详见 `task-5-report.md`。
