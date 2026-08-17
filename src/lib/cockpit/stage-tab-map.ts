// 十三期 T3: 内容详情整页路由 —— ContentDrawer 的 tab 概念与 URL 上 `?step=` 携带的
// WorkStage 概念需要互相转换。两处消费方（Cockpit.tsx 的 openContent 与
// content-detail-client.tsx 的 initialTab 计算）必须用同一份映射表，不各写一份。
import type { WorkStage } from "./model";
import type { ContentDrawerTab } from "@/components/cockpit/content-drawer";

export const STAGE_TO_TAB: Record<WorkStage, ContentDrawerTab> = {
  inbox: "overview", // inbox（灵感）阶段没有对应的抽屉 tab，回落到概览
  topic: "topic",
  script: "script",
  recording: "recording",
  editing: "editing",
  publishing: "publish",
  review: "review",
};

export const TAB_TO_STAGE: Partial<Record<ContentDrawerTab, WorkStage>> = Object.fromEntries(
  (Object.entries(STAGE_TO_TAB) as [WorkStage, ContentDrawerTab][]).map(([stage, tab]) => [tab, stage]),
) as Partial<Record<ContentDrawerTab, WorkStage>>;
