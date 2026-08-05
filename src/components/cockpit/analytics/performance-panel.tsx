"use client";

import { useDashboardSummary } from "./use-dashboard-summary";
import { NicheDistribution } from "./niche-distribution";
import { TopPerformers } from "./top-performers";

/** 大目标「内容表现」区块：自取数，loading 时不渲染，出错时只显示一行提示。 */
export function PerformancePanel() {
  const { data, loading, error } = useDashboardSummary();

  if (loading) return null;
  if (error) return <small className="panel-fetch-error">内容表现加载失败：{error}</small>;
  if (!data) return null;

  return (
    <section className="panel performance-panel">
      <header className="panel-heading">
        <div><span className="eyebrow">CONTENT PERFORMANCE</span><h2>内容表现</h2></div>
      </header>
      <div className="performance-panel-body">
        <NicheDistribution rows={data.nicheDistribution} />
        <TopPerformers items={data.topPerformers} />
      </div>
    </section>
  );
}
