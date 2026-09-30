# 平台差异化流水线 (cockpit 九期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每平台各自的阶段流（小红书去掉录制/剪辑、script 标「文案」，定稿推进按平台跳转），数据层 8 阶段超集不动。Spec: `docs/superpowers/specs/2026-08-15-platform-stage-flows-design.md`。

**Architecture:** 新纯模块 `platform-stages.ts` 是流层唯一事实来源；前端消费点（平台看板/抽屉 tab/档期/今日推进/文案）改走流层函数；服务端 picked 推进用 `nextStageFor`；存量 xhs 脏阶段一次性归并脚本。

**Tech Stack:** 同前（无新依赖）。

## Global Constraints

- 数据层 `ContentStage` 枚举、CockpitContent.stage 取值域、workspace rev 机制一概不动；API 不加阶段硬校验。
- xhs 流逐字：`['inbox', 'topic', 'script', 'publishing', 'review']`；其余与未知平台走 `DEFAULT_STAGE_FLOW = WORK_STAGES`（现状 7 阶段）。
- xhs 文案改写仅两处：`stageLabelFor(xhs, 'script') = '文案'`、`nextActionFor(xhs, 'script') = '完成文案与配图'`；其余一律回落 STAGE_LABELS/NEXT_ACTIONS。
- **内容总览（跨平台混合视图）保留 8 列超集不变**；各平台流水线视图列 = `stageFlowFor(platform)`。
- `nextStageFor` 对流外 stage（存量脏值）：按全集顺序找流内第一个位于其后的合法阶段；review 之后语义同现状推进边界（不自动 archived）。
- 定稿(picked)推进：`script → nextStageFor(platform, 'script')`——douyin→recording、xiaohongshu→publishing。
- 归并脚本默认 dry-run、`--apply` 执行、事务 + `bumpCockpitRev`、同事务清理 xhs 卡 recording/editing 的 stageSchedule 排期；StageEvent 历史不动。
- 禁止新增对 STAGE_LABELS/NEXT_ACTIONS/WORK_STAGES 的平台语境直引（非平台语境如归档统计可保留既有直引）。
- UI 无彩色 emoji；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 平台阶段流层（纯模块 TDD）

**Files:** Create `src/lib/cockpit/platform-stages.ts`；Test `tests/lib/cockpit/platform-stages.test.ts`。
**Interfaces (Produces，T2-T4 消费——签名逐字):**
```ts
import { CONTENT_STAGES, STAGE_LABELS, NEXT_ACTIONS, WORK_STAGES, SCHEDULABLE_STAGES } from './model';
import type { ContentStage, WorkStage } from './model';
export const PLATFORM_STAGE_FLOW: Record<string, WorkStage[]> = {
  xiaohongshu: ['inbox', 'topic', 'script', 'publishing', 'review'],
};
export const DEFAULT_STAGE_FLOW: WorkStage[] = WORK_STAGES;
export function stageFlowFor(platform: string): WorkStage[]
export function stageLabelFor(platform: string, stage: ContentStage): string
export function nextActionFor(platform: string, stage: ContentStage): string
export function nextStageFor(platform: string, stage: ContentStage): ContentStage | null
// 流内：取流序下一个；流尾 review → null（同现状边界，不自动 archived）；archived → null
// 流外脏值：按 CONTENT_STAGES 全集顺序，找该平台流内第一个位于其后的阶段；其后无 → null
export function isStageInFlow(platform: string, stage: ContentStage): boolean  // archived 不在任何 flow（flow 是 WorkStage[]）
export function schedulableStagesFor(platform: string): WorkStage[]  // stageFlowFor ∩ SCHEDULABLE_STAGES 保持 SCHEDULABLE 顺序
```
**Test（TDD 全覆盖）:** xhs 流内容与顺序；douyin/未知平台 = DEFAULT；label/nextAction 两处改写+其余回落；nextStageFor 矩阵（xhs script→publishing、douyin script→recording、xhs 流外 recording→publishing、editing→publishing、review→null、archived→null、未知平台照全集）；schedulable（xhs = topic/script/publishing）。
- [ ] Step 1: RED→GREEN；commit `feat(cockpit): 平台阶段流层纯模块`

## Task 2: 前端消费点改造（看板/抽屉/档期/今日推进）

**Files:** Modify `src/components/cockpit/views/platform.tsx`（平台看板列 = stageFlowFor(platform)，列头/卡片徽标文案 stageLabelFor；总览 pipeline.tsx **不动**——先确认它与 platform.tsx 的复用关系，若共用组件需加平台参数区分超集/流两态）；Modify `src/components/cockpit/content-drawer.tsx`（tab 数组按 item.platform 过滤：xhs 无 recording/editing tab；script tab 标题「文案」走 stageLabelFor；tab 内阶段名/下一步文案走流层）；Modify `src/components/cockpit/views/schedule.tsx`（可排阶段 schedulableStagesFor(item.platform)）；Modify `src/components/cockpit/views/momentum.tsx` 及 `src/lib/cockpit/workflow.ts` 中今日任务生成（不在流内的阶段不生成任务——先 grep 任务生成逻辑实际位置）；全部消费点文案走 stageLabelFor/nextActionFor。
**Interfaces:** Consumes T1 全部函数。
**Test:** workflow 任务生成的纯函数部分补平台流测试（xhs 卡不产出录制/剪辑任务）；视图层 dev 手工走查（走查清单：①xhs 平台看板 5 列 ②douyin 看板 7 列不变 ③总览 8 列 ④xhs 抽屉无录制/剪辑 tab 且脚本 tab 显示「文案」 ⑤douyin 抽屉 7 tab 不变 ⑥xhs 档期无录制/剪辑可排 ⑦今日推进无 xhs 录制任务）。
- [ ] Step 1: TDD（纯函数）+ 实现 + 走查；commit `feat(cockpit): 前端消费点接平台阶段流`

## Task 3: 服务端定稿推进按平台

**Files:** Modify `src/app/api/v1/scripts/[id]/picked/route.ts`（stage 自动推进 script→ 改调 `nextStageFor(draft.platform, 'script')`——推进目标非 null 且关联内容 stage==='script' 才推进，逻辑其余不动）；Modify `src/lib/pipeline/stage.ts`（语义注释同步）；Test `tests/api/scripts/picked.test.ts` 补：douyin 定稿→recording（回归）、xhs 定稿→publishing（新语义）、gongzhonghao 定稿→recording（DEFAULT 流）。
**Interfaces:** Consumes T1 `nextStageFor`。
- [ ] Step 1: TDD；commit `feat(script): 定稿推进按平台阶段流`

## Task 4: 存量归并脚本

**Files:** Create `scripts/migrate-xhs-stages.ts`（查 CockpitContent(platform='xiaohongshu', stage in ['recording','editing'])；默认 dry-run 打印 id/title/stage；`--apply` 时单事务：逐卡 stage→'script' + 该卡 workspace 内 recording/editing 的 stageSchedule 排期清理（排期存储位置先读 server-store/model 确认——在 CockpitContent 行内字段还是 workspace Json，按实际写）+ `bumpCockpitRev(userId, tx)`；输出归并数）；package.json 加 `migrate:xhs-stages` script。
**Test:** 归并逻辑抽纯函数（`planXhsStageMigration(contents) → {id, from, to}[]`）单测；DB 操作部分 dry-run 手工验证（真库跑 dry-run 输出贴报告；有存量就 --apply 真跑，没有就造一条测试卡验证后删除）。
- [ ] Step 1: TDD+实现+真库验证；commit `feat(script): xhs 存量阶段归并脚本 (dry-run/apply)`

## Task 5: 收尾 — 文档 + 走查 E2E

**Files:** README 九期段（平台阶段流表格 + 归并脚本用法一句）；spec 回写「## 7. 实际实施结论」。
**E2E（真机走查为主，无外部 API 消耗）:** ①T2 走查清单全项复核（含明暗主题下列头渲染）②真实定稿一篇 xhs 稿（已有稿即可）→ 看板卡片直接出现在「发布」列 ③douyin 定稿回归 → 录制列 ④归并脚本 dry-run 输出留档 ⑤typecheck+test+build 全绿。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(cockpit): 九期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 流层七函数(T1) ✓ §2 五类消费点(T2) ✓ §3 picked 推进+不加硬校验(T3, 硬校验=不做无任务) ✓ §4 归并脚本含排期清理(T4) ✓ §5 YAGNI 未越界 ✓ §6 风险：遗漏消费点(T2 走查清单+T5 复核)/脏值回落(T1 矩阵测试)/排期清理(T4)/改平台字段回落(T1 nextStageFor 流外语义) ✓。
- 类型一致性：七个导出 T1 定义、T2/T3 消费签名一致 ✓；planXhsStageMigration 仅 T4 内部 ✓。
- 已知不确定点（实施核实记账本）：pipeline.tsx 与 platform.tsx 的组件复用关系（T2 标注）；今日任务生成逻辑实际位置（T2 标注 grep）；stageSchedule 排期存储位置（T4 标注）。
