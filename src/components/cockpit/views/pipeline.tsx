"use client";

import { useState, type DragEvent } from "react";
import {
  CONTENT_STAGES,
  DEFAULT_PAGE_TITLES,
  NEXT_ACTIONS,
  STAGE_LABELS,
  type ContentPlatformEx,
  type ContentStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { Badge, EditablePageTitle, Empty, Icon, date } from "../shared";

// 三期 T5: platformFilter/hideHeading —— 平台流水线页 (PlatformView) 内嵌同一份组件
// 而不是复制一份新的看板；platformFilter 只在 contents 进入视图的唯一入口 (下方
// platformScoped) 处过滤一次，之后的看板/列表逻辑零改动。hideHeading 复用 T4
// GoalsView/ReviewView 的 embedded 先例：容器 (PlatformView) 已有自己的
// `.page-heading`，这里只隐藏文字部分，避免同一屏堆叠两份标题。
export function ContentOverviewView({ state, pageTitle, updateTitle, query, setQuery, type, setType, open, addToday, dropStage, platformFilter, hideHeading = false }: { state: WorkspaceState; pageTitle: string; updateTitle: (value: string) => void; query: string; setQuery: (value: string) => void; type: string; setType: (value: string) => void; open: (id: string) => void; addToday: (id: string) => void; dropStage: (event: DragEvent, stage: ContentStage) => void; platformFilter?: ContentPlatformEx; hideHeading?: boolean }) {
  const [mode, setMode] = useState<"pipeline" | "list">("pipeline");
  const [stageFilter, setStageFilter] = useState("全部阶段");
  const [tierFilter, setTierFilter] = useState("全部档位");
  const [priorityFilter, setPriorityFilter] = useState("全部优先级");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const stages = CONTENT_STAGES;
  const platformScoped = platformFilter ? state.contents.filter((item) => item.platform === platformFilter) : state.contents;
  const baseFiltered = platformScoped.filter((item) =>
    (type === "全部类型" || item.contentType === type)
    && `${item.title} ${item.idea} ${item.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const filtered = baseFiltered.filter((item) =>
    (stageFilter === "全部阶段" || item.stage === stageFilter)
    && (tierFilter === "全部档位" || item.tier === tierFilter)
    && (priorityFilter === "全部优先级" || item.priority === priorityFilter)
    && (statusFilter === "全部状态" || item.publicationStatus === statusFilter),
  );
  const hasExtraFilters = stageFilter !== "全部阶段" || tierFilter !== "全部档位" || priorityFilter !== "全部优先级" || statusFilter !== "全部状态";
  const clearFilters = () => {
    setQuery("");
    setType("全部类型");
    setStageFilter("全部阶段");
    setTierFilter("全部档位");
    setPriorityFilter("全部优先级");
    setStatusFilter("全部状态");
  };
  const priorityLabels = { high: "高", normal: "普通", low: "低" };
  const statusLabels = { draft: "未排期", scheduled: "已排期", published: "已发布" };
  const nextPlannedFor = (contentId: string) => state.stageEvents
    .filter((event) => event.contentId === contentId && !event.completedAt)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.rank - b.rank)[0];
  return <section className="page pipeline-page">
    {!hideHeading ? <div className="page-heading"><span className="eyebrow">CONTENT OVERVIEW</span><EditablePageTitle value={pageTitle} fallback={DEFAULT_PAGE_TITLES.pipeline} onChange={updateTitle} /><p>在流程中推动阶段，在列表中快速搜索、筛选和查看全部内容。</p></div> : null}
    <div className="content-overview-tabs" role="tablist" aria-label="内容总览显示方式"><button className={mode === "pipeline" ? "active" : ""} onClick={() => setMode("pipeline")} role="tab" aria-selected={mode === "pipeline"}><span>流程</span><small>Pipeline</small></button><button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")} role="tab" aria-selected={mode === "list"}><span>列表</span><small>List</small></button></div>
    <div className={`pipeline-toolbar ${mode === "list" ? "list-toolbar" : ""}`}>
      <label className="search-field"><Icon name="search" /><input id="content-overview-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、原始想法或标签" /></label>
      <select value={type} onChange={(e) => setType(e.target.value)}><option>全部类型</option>{state.contentTypes.map((item) => <option key={item}>{item}</option>)}</select>
      {mode === "list" ? <>
        <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option>全部阶段</option>{CONTENT_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}</select>
        <select value={tierFilter} onChange={(event) => setTierFilter(event.target.value)}><option>全部档位</option><option value="A">A档</option><option value="B">B档</option><option value="C">C档</option></select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>全部优先级</option><option value="high">高优先级</option><option value="normal">普通优先级</option><option value="low">低优先级</option></select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>全部状态</option><option value="draft">未排期</option><option value="scheduled">已排期</option><option value="published">已发布</option></select>
      </> : null}
      {(query || type !== "全部类型" || hasExtraFilters) ? <button className="text-button clear-content-filters" onClick={clearFilters}>清除筛选</button> : null}
      <span>{(mode === "pipeline" ? baseFiltered : filtered).length} 条内容</span>
    </div>
    {mode === "pipeline" ? <div className="kanban">{stages.map((stage) => {
      const items = baseFiltered.filter((item) => item.stage === stage);
      return <section key={stage} className="kanban-column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropStage(e, stage)}>
        <header><div><i className="stage-dot" style={{ background: state.stageColors[stage] }} /><h2>{STAGE_LABELS[stage]}</h2></div><span>{items.length}</span></header>
        <div className="kanban-list">{items.map((item) => {
          const todayEvent = state.stageEvents.find((event) => event.contentId === item.id && event.stage === item.stage && event.plannedDate === date);
          const nextPlanned = state.stageEvents
            .filter((event) => event.contentId === item.id && !event.completedAt)
            .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.rank - b.rank)[0];
          return <article key={item.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/content-id", item.id)} className="kanban-card">
            <button className="kanban-card-main" onClick={() => open(item.id)}><div className="card-tags"><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge><span>{item.contentType}</span></div><h3>{item.title}</h3><p>{item.idea}</p><footer><span>{NEXT_ACTIONS[item.stage]}</span>{nextPlanned ? <time>{STAGE_LABELS[nextPlanned.stage]} · {nextPlanned.plannedDate.slice(5)}</time> : null}</footer></button>
            {stage === "archived" ? <span className="card-today archived">已归档</span> : stage === "inbox" ? <span className="card-today archived">灵感无需排期 · 先推进到大纲</span> : !todayEvent ? <button className="card-today" onClick={() => addToday(item.id)}>＋ 当前阶段安排今天</button> : <span className="card-today added">{todayEvent.completedAt ? "今日阶段已完成" : `今日 #${todayEvent.rank}`}</span>}
          </article>;
        })}</div>
      </section>;
    })}</div> : <section className="panel content-list-panel">
      {filtered.length ? <div className="content-table-wrap"><table className="content-table">
        <thead><tr><th>内容</th><th>当前阶段</th><th>类型 / 档位</th><th>优先级</th><th>发布状态</th><th>下一档期</th><th>最近更新</th></tr></thead>
        <tbody>{filtered.map((item) => {
          const nextPlanned = nextPlannedFor(item.id);
          return <tr key={item.id}>
            <td><button className="content-list-title" onClick={() => open(item.id)}><strong>{item.title}</strong><small>{item.tags.length ? item.tags.slice(0, 3).join(" · ") : item.idea || "尚未补充原始想法"}</small></button></td>
            <td><Badge tone={item.stage} color={state.stageColors[item.stage]}>{STAGE_LABELS[item.stage]}</Badge></td>
            <td><span className="content-list-type">{item.contentType}</span><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></td>
            <td><span className={`priority-label priority-${item.priority}`}>{priorityLabels[item.priority]}</span></td>
            <td><span className={`publication-label publication-${item.publicationStatus}`}>{statusLabels[item.publicationStatus]}</span>{item.publishedAt ? <small className="publication-date">{item.publishedAt}</small> : null}</td>
            <td>{nextPlanned ? <button className="next-schedule-link" onClick={() => open(item.id)}><strong>{STAGE_LABELS[nextPlanned.stage]}</strong><small>{nextPlanned.plannedDate}</small></button> : <span className="table-empty">—</span>}</td>
            <td><time>{item.updatedAt || item.createdAt}</time></td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="没有匹配的内容" body="调整筛选条件，或者新建一条内容。" action={<button className="secondary-button" onClick={clearFilters}>清除筛选</button>} />}
    </section>}
  </section>;
}
