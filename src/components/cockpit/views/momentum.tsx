"use client";

import {
  NEXT_ACTIONS,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  type ContentItem,
  type LiveSession,
  type ScheduleObject,
  type ScheduleObjectType,
  type StageEvent,
  type WorkspaceState,
  type WorkStage,
} from "@/lib/cockpit/model";
import { percent, startOfWeekISO } from "@/lib/cockpit/calculations";
import { stageIndex, stageProgress } from "@/lib/cockpit/workflow";
// MomentumPeriod 的唯一定义在 view-routing.ts（和 `resolveInitialMomentumTab` 配套，
// 供纯逻辑单测复用），这里只做 type-only import。
import type { MomentumPeriod } from "@/lib/cockpit/view-routing";
import { Badge, Empty, EditablePageTitle, Icon, date, shiftDate } from "../shared";
import { ScheduleView } from "./schedule";

export type DailyStageEntry = { event: StageEvent; item: ContentItem };

function TodoCard({ entry, index, overdue = false, stageColors, open, openSchedule, moveToday, toggleComplete, removeFromToday }: {
  entry: DailyStageEntry;
  index: number;
  overdue?: boolean;
  stageColors: WorkspaceState["stageColors"];
  open: (id: string) => void;
  openSchedule: () => void;
  moveToday: (eventId: string, direction: -1 | 1) => void;
  toggleComplete: (eventId: string) => void;
  removeFromToday: (eventId: string) => void;
}) {
  const { event, item } = entry;
  const isDone = Boolean(event.completedAt);
  const waiting = !isDone && stageIndex(item.stage) < stageIndex(event.stage);
  return <article className={`${isDone ? "today-card completed" : "today-card"} ${waiting ? "waiting" : ""} ${overdue ? "overdue-todo-card" : ""}`}>
    <label className="today-check" title={waiting ? `先完成${STAGE_LABELS[item.stage]}阶段` : isDone ? "取消完成并恢复原阶段" : `完成${STAGE_LABELS[event.stage]}阶段`}>
      <input type="checkbox" checked={isDone} disabled={waiting} onChange={() => toggleComplete(event.id)} aria-label={isDone ? `撤销完成：${item.title}·${STAGE_LABELS[event.stage]}` : `完成：${item.title}·${STAGE_LABELS[event.stage]}`} />
      <span aria-hidden="true">✓</span>
    </label>
    <div className={overdue ? "rank overdue-date" : "rank"}>{overdue ? <><small>原定</small><span>{event.plannedDate.slice(5).replace("-", "/")}</span></> : String(event.rank || index + 1).padStart(2, "0")}</div>
    <button className="today-main" onClick={() => open(item.id)}>
      {isDone ? <div className="completed-copy"><h3>{item.title}</h3><p>{STAGE_LABELS[event.stage]}已完成 · 当前进入{STAGE_LABELS[item.stage]}</p></div> : <><div><Badge tone={event.stage} color={stageColors[event.stage]}>{STAGE_LABELS[event.stage]}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge>{overdue ? <Badge tone="clay">逾期</Badge> : null}{waiting ? <Badge tone="neutral">等待前置阶段</Badge> : null}</div><h3>{item.title}</h3><p><Icon name="arrow" />{waiting ? `先完成${STAGE_LABELS[item.stage]}` : NEXT_ACTIONS[event.stage]}</p></>}
    </button>
    {!isDone ? overdue
      ? <div className="today-controls overdue-controls"><button onClick={openSchedule} aria-label={`调整${item.title}的${STAGE_LABELS[event.stage]}排期`}>改期</button><button onClick={() => removeFromToday(event.id)} aria-label="取消逾期排期">×</button></div>
      : <div className="today-controls"><button onClick={() => moveToday(event.id, -1)} aria-label="上移">↑</button><button onClick={() => moveToday(event.id, 1)} aria-label="下移">↓</button><button onClick={() => removeFromToday(event.id)} aria-label="取消今日排期">×</button></div>
      : <span className="done-status">阶段完成</span>}
  </article>;
}

export function DayView({ items, overdueItems, stageColors, open, openSchedule, moveToday, toggleComplete, removeFromToday }: {
  items: DailyStageEntry[];
  overdueItems: DailyStageEntry[];
  stageColors: WorkspaceState["stageColors"];
  open: (id: string) => void;
  openSchedule: () => void;
  moveToday: (eventId: string, direction: -1 | 1) => void;
  toggleComplete: (eventId: string) => void;
  removeFromToday: (eventId: string) => void;
}) {
  const pending = items.filter(({ event }) => !event.completedAt).length;
  const completed = items.length - pending;
  return <div className="today-view-stack">
    {overdueItems.length ? <section className="panel overdue-todo-panel">
      <header className="overdue-todo-heading"><div><span className="eyebrow">OVERDUE</span><h2>逾期未完成</h2><p>保留原排期，不会自动挪入今天；完成、改期或移除后自动消失。</p></div><div><span>{overdueItems.length} 项</span><button className="text-button" onClick={openSchedule}>调整档期 →</button></div></header>
      <div className="today-list overdue-todo-list">{overdueItems.map((entry, index) => <TodoCard key={entry.event.id} entry={entry} index={index} overdue stageColors={stageColors} open={open} openSchedule={openSchedule} moveToday={moveToday} toggleComplete={toggleComplete} removeFromToday={removeFromToday} />)}</div>
    </section> : null}
    <div className="panel today-panel todo-only-panel">
      <div className="panel-heading"><div><span className="eyebrow">TODAY&apos;S TODO</span><h2>今天要完成的阶段</h2></div><div className="todo-heading-actions"><span className="count-label">{pending} 待完成 · {completed} 已完成</span><button className="text-button" onClick={openSchedule}>调整档期 →</button></div></div>
      {items.length ? <div className="today-list">{items.map((entry, index) => <TodoCard key={entry.event.id} entry={entry} index={index} stageColors={stageColors} open={open} openSchedule={openSchedule} moveToday={moveToday} toggleComplete={toggleComplete} removeFromToday={removeFromToday} />)}</div> : <Empty title="今天没有 Todo" body="去档期规划，把某条内容的一个阶段拖到今天。" action={<button className="secondary-button" onClick={openSchedule}>打开档期规划</button>} />}
      {items.length ? <div className="todo-footnote"><span>今日 Todo 完全来自档期</span><button onClick={openSchedule}>添加或调整阶段</button></div> : null}
    </div>
  </div>;
}

export function WeekOverview({ state, open, openSchedule }: {
  state: WorkspaceState;
  open: (id: string) => void;
  openSchedule: () => void;
}) {
  const weekStart = startOfWeekISO(new Date(`${date}T12:00:00`));
  const weekEnd = shiftDate(weekStart, 6);
  const weeklyEvents = state.stageEvents
    .filter((event) => SCHEDULABLE_STAGES.includes(event.stage) && event.plannedDate >= weekStart && event.plannedDate <= weekEnd)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.rank - b.rank);
  const grouped = new Map<string, StageEvent[]>();
  for (const event of weeklyEvents) grouped.set(event.contentId, [...(grouped.get(event.contentId) ?? []), event]);
  const weeklyContents = Array.from(grouped.entries())
    .map(([contentId, events]) => {
      const item = state.contents.find((content) => content.id === contentId);
      return item ? { item, events } : null;
    })
    .filter((entry): entry is { item: ContentItem; events: StageEvent[] } => Boolean(entry))
    .sort((a, b) => {
      const aDone = a.events.every((event) => Boolean(event.completedAt));
      const bDone = b.events.every((event) => Boolean(event.completedAt));
      return Number(aDone) - Number(bDone) || a.events[0].plannedDate.localeCompare(b.events[0].plannedDate);
    });
  const completedStages = weeklyEvents.filter((event) => Boolean(event.completedAt)).length;
  const pendingStages = weeklyEvents.length - completedStages;
  const overdueStages = weeklyEvents.filter((event) => !event.completedAt && event.plannedDate < date).length;
  const publishedContents = state.contents.filter(
    (item) => item.publicationStatus === "published" && item.publishedAt >= weekStart && item.publishedAt <= weekEnd,
  );
  const expectedPublishIds = new Set([
    ...weeklyEvents.filter((event) => event.stage === "publishing").map((event) => event.contentId),
    ...publishedContents.map((item) => item.id),
  ]);
  const formatStageDate = (plannedDate: string) => {
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${plannedDate}T12:00:00`));
    return `${weekday} ${plannedDate.slice(5).replace("-", ".")}`;
  };

  return <div className="week-overview">
    <section className="panel week-summary-panel">
      <header><div><span className="eyebrow">THIS WEEK</span><h2>{weekStart.slice(5)} — {weekEnd.slice(5)}</h2></div><button className="text-button" onClick={openSchedule}>调整本周档期 →</button></header>
      <div className="week-summary-kpis">
        <div><span>已发布 / 预期发布</span><strong>{publishedContents.length}<small> / {expectedPublishIds.size}</small></strong><em>以发布阶段档期统计</em></div>
        <div><span>阶段完成</span><strong>{completedStages}<small> / {weeklyEvents.length}</small></strong><em>{weeklyEvents.length ? `${percent(completedStages / weeklyEvents.length)} 完成率` : "本周暂无阶段"}</em></div>
        <div><span>涉及内容</span><strong>{weeklyContents.length}</strong><em>本周需要处理的内容</em></div>
        <div className={overdueStages ? "risk" : ""}><span>待推进阶段</span><strong>{pendingStages}</strong><em>{overdueStages ? `${overdueStages} 个已逾期` : "当前无逾期"}</em></div>
      </div>
    </section>

    <section className="week-content-section">
      <div className="week-content-heading"><div><span className="eyebrow">WEEKLY CONTENT</span><h2>本周需要推进的内容</h2></div><span>{weeklyContents.length} 条内容 · {weeklyEvents.length} 个阶段</span></div>
      {weeklyContents.length ? <div className="week-content-grid">{weeklyContents.map(({ item, events }) => {
        const completed = events.filter((event) => Boolean(event.completedAt)).length;
        const allDone = completed === events.length;
        const progress = Math.round(stageProgress(item.stage) * 100);
        return <article key={item.id} className={`week-content-card ${allDone ? "completed" : ""}`} style={{ "--stage-color": state.stageColors[item.stage] } as React.CSSProperties}>
          <button onClick={() => open(item.id)}>
            <header><div><Badge tone={item.stage} color={state.stageColors[item.stage]}>当前 · {STAGE_LABELS[item.stage]}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></div><span>{progress}%</span></header>
            <h3>{item.title}</h3>
            <div className="week-stage-list">{events.map((event) => {
              const isDone = Boolean(event.completedAt);
              const overdue = !isDone && event.plannedDate < date;
              return <span key={event.id} className={`${isDone ? "completed" : ""} ${overdue ? "overdue" : ""}`} style={{ "--stage-color": state.stageColors[event.stage] } as React.CSSProperties}><i>{isDone ? "✓" : ""}</i><strong>{STAGE_LABELS[event.stage]}</strong><time>{formatStageDate(event.plannedDate)}</time></span>;
            })}</div>
            <footer><span>{item.contentType}</span><strong>{completed} / {events.length} 阶段完成</strong></footer>
          </button>
        </article>;
      })}</div> : <div className="panel"><Empty title="本周还没有安排内容" body="去档期规划，把要推进的内容阶段放进本周。" action={<button className="secondary-button" onClick={openSchedule}>打开档期规划</button>} /></div>}
    </section>
  </div>;
}

const MOMENTUM_DESCRIPTIONS: Record<MomentumPeriod, string> = {
  today: "今日 Todo 自动读取档期；一个任务就是一条内容的一个大阶段。",
  week: "本周总览自动汇总档期，不需要再维护一份周计划。",
  schedule: "安排内容阶段，也可以放入复盘、直播和你自定义的日程对象。",
};

export function MomentumView({
  momentumPeriod,
  setMomentumPeriod,
  pageTitle,
  pageTitleFallback,
  updatePageTitle,
  state,
  todayEntries,
  overdueEntries,
  open,
  openReview,
  moveToday,
  toggleComplete,
  removeFromToday,
  schedule,
  moveEvent,
  unschedule,
  createReviewDay,
  moveReviewDay,
  removeReviewDay,
  saveLive,
  moveLive,
  removeLive,
  saveObjectType,
  archiveObjectType,
  removeObjectType,
  saveObject,
  moveObject,
  removeObject,
  configureColors,
}: {
  momentumPeriod: MomentumPeriod;
  setMomentumPeriod: (period: MomentumPeriod) => void;
  pageTitle: string;
  pageTitleFallback: string;
  updatePageTitle: (value: string) => void;
  state: WorkspaceState;
  todayEntries: DailyStageEntry[];
  overdueEntries: DailyStageEntry[];
  open: (id: string) => void;
  openReview: () => void;
  moveToday: (eventId: string, direction: -1 | 1) => void;
  toggleComplete: (eventId: string) => void;
  removeFromToday: (eventId: string) => void;
  schedule: (contentId: string, stage: WorkStage, plannedDate: string) => void;
  moveEvent: (eventId: string, plannedDate: string) => void;
  unschedule: (contentId: string, stage: WorkStage) => void;
  createReviewDay: (plannedDate: string) => void;
  moveReviewDay: (reviewDayId: string, plannedDate: string) => void;
  removeReviewDay: (reviewDayId: string) => void;
  saveLive: (session: LiveSession) => void;
  moveLive: (liveSessionId: string, plannedDate: string) => void;
  removeLive: (liveSessionId: string) => void;
  saveObjectType: (type: ScheduleObjectType) => void;
  archiveObjectType: (typeId: string) => void;
  removeObjectType: (typeId: string) => void;
  saveObject: (object: ScheduleObject) => void;
  moveObject: (objectId: string, plannedDate: string) => void;
  removeObject: (objectId: string) => void;
  configureColors: () => void;
}) {
  const openSchedule = () => setMomentumPeriod("schedule");
  return <section className="page momentum-page">
    <div className="page-heading split-heading">
      <div><span className="eyebrow">MOMENTUM</span><EditablePageTitle value={pageTitle} fallback={pageTitleFallback} onChange={updatePageTitle} /><p>{MOMENTUM_DESCRIPTIONS[momentumPeriod]}</p></div>
      <div className="period-switch momentum-period-switch" role="tablist" aria-label="推进时间范围">
        <button className={momentumPeriod === "today" ? "active" : ""} onClick={() => setMomentumPeriod("today")} role="tab" aria-selected={momentumPeriod === "today"}>今日</button>
        <button className={momentumPeriod === "week" ? "active" : ""} onClick={() => setMomentumPeriod("week")} role="tab" aria-selected={momentumPeriod === "week"}>本周</button>
        <button className={momentumPeriod === "schedule" ? "active" : ""} onClick={() => setMomentumPeriod("schedule")} role="tab" aria-selected={momentumPeriod === "schedule"}>档期</button>
      </div>
    </div>
    {momentumPeriod === "today"
      ? <DayView items={todayEntries} overdueItems={overdueEntries} stageColors={state.stageColors} open={open} openSchedule={openSchedule} moveToday={moveToday} toggleComplete={toggleComplete} removeFromToday={removeFromToday} />
      : momentumPeriod === "week"
      ? <WeekOverview state={state} open={open} openSchedule={openSchedule} />
      : <ScheduleView state={state} open={open} openReview={openReview} schedule={schedule} moveEvent={moveEvent} unschedule={unschedule} createReviewDay={createReviewDay} moveReviewDay={moveReviewDay} removeReviewDay={removeReviewDay} saveLive={saveLive} moveLive={moveLive} removeLive={removeLive} saveObjectType={saveObjectType} archiveObjectType={archiveObjectType} removeObjectType={removeObjectType} saveObject={saveObject} moveObject={moveObject} removeObject={removeObject} configureColors={configureColors} />}
  </section>;
}
