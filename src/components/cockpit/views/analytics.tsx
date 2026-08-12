"use client";

import { calculateGoalHealth } from "@/lib/cockpit/calculations";
import type { ContentItem, GoalCycle, WorkspaceState } from "@/lib/cockpit/model";
// AnalyticsTab 的唯一定义在 view-routing.ts（和 `resolveInitialAnalyticsTab` 配套，
// 供纯逻辑单测复用），这里只做 type-only import，同 momentum.tsx 对 MomentumPeriod 的处理。
import type { AnalyticsTab } from "@/lib/cockpit/view-routing";
import { GoalsView } from "./goals";
import { ReviewView } from "./review";

const ANALYTICS_DESCRIPTIONS: Record<AnalyticsTab, string> = {
  goals: "跟踪这一阶段的产出、粉丝和质量目标，数据随发布记录与快照自动更新。",
  review: "发布后的内容在这里复盘，把判断沉淀成下一条能直接用的规则。",
};

// 三期 T4: 内容数据分析合并 —— 容器持有 analyticsTab（目标/复盘）状态，原样渲染
// GoalsView/ReviewView（两者零逻辑改动，仅各加一个 embedded prop 隐藏自身标题，
// 避免和这里的容器级 `.page-heading` 堆叠成两份标题；见 goals.tsx/review.tsx 注释）。
export function AnalyticsView({
  analyticsTab,
  setAnalyticsTab,
  state,
  goalsPageTitle,
  updateGoalsTitle,
  health,
  followers,
  published,
  updateGoal,
  notify,
  reviewPageTitle,
  updateReviewTitle,
  open,
  setState,
}: {
  analyticsTab: AnalyticsTab;
  setAnalyticsTab: (tab: AnalyticsTab) => void;
  state: WorkspaceState;
  goalsPageTitle: string;
  updateGoalsTitle: (value: string) => void;
  health: ReturnType<typeof calculateGoalHealth>;
  followers: number;
  published: ContentItem[];
  updateGoal: (patch: Partial<GoalCycle>) => void;
  notify: (message: string) => void;
  reviewPageTitle: string;
  updateReviewTitle: (value: string) => void;
  open: (id: string) => void;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
}) {
  return <section className="page analytics-page">
    <div className="page-heading split-heading">
      <div><span className="eyebrow">ANALYTICS</span><h1>内容数据分析</h1><p>{ANALYTICS_DESCRIPTIONS[analyticsTab]}</p></div>
      <div className="period-switch analytics-period-switch" role="tablist" aria-label="内容数据分析分区">
        <button className={analyticsTab === "goals" ? "active" : ""} onClick={() => setAnalyticsTab("goals")} role="tab" aria-selected={analyticsTab === "goals"}>目标</button>
        <button className={analyticsTab === "review" ? "active" : ""} onClick={() => setAnalyticsTab("review")} role="tab" aria-selected={analyticsTab === "review"}>复盘</button>
      </div>
    </div>
    {analyticsTab === "goals"
      ? <GoalsView embedded state={state} pageTitle={goalsPageTitle} updateTitle={updateGoalsTitle} health={health} followers={followers} published={published} updateGoal={updateGoal} setState={setState} notify={notify} />
      : <ReviewView embedded state={state} pageTitle={reviewPageTitle} updateTitle={updateReviewTitle} open={open} setState={setState} />}
  </section>;
}
