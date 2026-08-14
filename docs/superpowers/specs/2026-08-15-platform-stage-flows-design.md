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
