"use client";

import { DEFAULT_PAGE_TITLES, type ContentItem, type WorkspaceState } from "@/lib/cockpit/model";
import { formatMetric, percent } from "@/lib/cockpit/calculations";
import { EditablePageTitle, Empty, StarRating, date, shiftDate } from "../shared";

function ReviewContentList({ items, reviewed, open }: { items: ContentItem[]; reviewed: boolean; open: (id: string) => void }) {
  if (!items.length) return <Empty title={reviewed ? "还没有已复盘内容" : "目前没有待复盘内容"} body={reviewed ? "完成第一篇内容复盘后，会沉淀到这里。" : "内容发布后，会自动进入待复盘区域。"} />;
  return <div className="review-ledger-list">{items.map((item) => {
    const reviewDue = item.publishedAt ? shiftDate(item.publishedAt, 3) : "";
    const overdue = !reviewed && Boolean(reviewDue && reviewDue <= date);
    return <button key={item.id} className="review-ledger-row" onClick={() => open(item.id)}><div className="review-ledger-content"><div><strong>{item.title}</strong><span className={`review-status-pill ${reviewed ? "completed" : overdue ? "overdue" : "pending"}`}>{reviewed ? "已复盘" : overdue ? "已到 T+3" : "待复盘"}</span></div><small>{item.contentType} · {item.tier}档 · 发布于 {item.publishedAt}</small></div><div className="review-ledger-metrics"><span><strong>{formatMetric(item.metrics.views)}</strong>播放</span><span><strong>{formatMetric(item.metrics.likes)}</strong>点赞</span><span><strong>{formatMetric(item.metrics.saves)}</strong>收藏</span><span><strong>+{formatMetric(item.metrics.followerGain)}</strong>涨粉</span><small>{item.metrics.capturedAt ? `${item.metrics.capturedAt.slice(5)} 快照` : "待录入数据快照"}</small></div><div className="review-ledger-judgment"><StarRating value={item.review.rating} compact /><p>{item.review.analysis || (reviewed ? "已保存复盘，暂未填写分析" : "点击进入，完成星级评价和复盘分析")}</p>{reviewed && item.review.completedAt ? <small>保存于 {item.review.completedAt.slice(0, 10)}</small> : null}</div><span className="review-ledger-arrow">→</span></button>;
  })}</div>;
}

export function ReviewView({ state, pageTitle, updateTitle, open, setState }: { state: WorkspaceState; pageTitle: string; updateTitle: (value: string) => void; open: (id: string) => void; setState: React.Dispatch<React.SetStateAction<WorkspaceState>> }) {
  const published = state.contents.filter((item) => item.publicationStatus === "published").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const pending = published.filter((item) => !item.review.completedAt);
  const reviewed = published.filter((item) => Boolean(item.review.completedAt)).sort((a, b) => b.review.completedAt.localeCompare(a.review.completedAt));
  const overdue = pending.filter((item) => item.publishedAt && shiftDate(item.publishedAt, 3) <= date).length;
  const completionRate = published.length ? reviewed.length / published.length : 0;
  const ratedReviewed = reviewed.filter((item) => item.review.rating > 0);
  const averageRating = ratedReviewed.length ? ratedReviewed.reduce((sum, item) => sum + item.review.rating, 0) / ratedReviewed.length : 0;
  return <section className="page review-page"><div className="page-heading"><span className="eyebrow">REVIEW LAB</span><EditablePageTitle value={pageTitle} fallback={DEFAULT_PAGE_TITLES.review} onChange={updateTitle} /><p>发布后自动进入待复盘；只有点击“保存复盘”，才会计入已复盘。</p></div>
    <div className="review-kpi-grid"><article className="panel"><span>发布样本</span><strong>{published.length}</strong><small>全部已发布内容</small></article><article className="panel pending"><span>待复盘</span><strong>{pending.length}</strong><small>{overdue ? `其中 ${overdue} 条已到 T+3` : "当前没有逾期复盘"}</small></article><article className="panel"><span>已复盘</span><strong>{reviewed.length}</strong><small>完成定型的内容</small></article><article className="panel"><span>复盘完成率</span><strong>{percent(completionRate)}</strong><small>{reviewed.length} / {published.length || 0} 条</small></article><article className="panel rating"><span>平均星级</span><strong>{averageRating ? averageRating.toFixed(1) : "—"}<em>/ 5</em></strong><small>统计有星级的已复盘内容</small></article></div>
    <div className="review-section-grid"><div className="panel review-ledger-panel pending-reviews"><div className="panel-heading"><div><span className="eyebrow">TO REVIEW</span><h2>待复盘</h2><p>发布即进入这里，优先处理已经到 T+3 的内容。</p></div><span className="count-label">{pending.length} 条</span></div><ReviewContentList items={pending} reviewed={false} open={open} /></div><div className="panel review-ledger-panel completed-reviews"><div className="panel-heading"><div><span className="eyebrow">REVIEWED</span><h2>已复盘</h2><p>已经完成定型评价与分析，可随时打开更新。</p></div><span className="count-label">{reviewed.length} 条</span></div><ReviewContentList items={reviewed} reviewed open={open} /></div></div>
    <div className="panel rules-panel"><div className="panel-heading"><div><span className="eyebrow">PLAYBOOK</span><h2>已沉淀的内容规则</h2></div><span>{state.insightRules.filter((item) => item.active).length} 条启用</span></div><div className="rule-grid">{state.insightRules.map((rule) => <article key={rule.id} className={rule.active ? "rule-card" : "rule-card inactive"}><span>判断 #{rule.id.slice(-2)}</span><p>{rule.text}</p><button onClick={() => setState((prev) => ({ ...prev, insightRules: prev.insightRules.map((item) => item.id === rule.id ? { ...item, active: !item.active } : item) }))}>{rule.active ? "停用" : "重新启用"}</button></article>)}</div></div>
  </section>;
}
