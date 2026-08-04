"use client";

import { useState, type DragEvent, type WheelEvent } from "react";
import {
  DEFAULT_SCHEDULE_OBJECT_TYPES,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  type LiveSession,
  type ScheduleObject,
  type ScheduleObjectType,
  type WorkStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { startOfWeekISO } from "@/lib/cockpit/calculations";
import { sortStageEvents, stageProgress } from "@/lib/cockpit/workflow";
import { Badge, Empty, date, shiftDate } from "../shared";

function scheduleTypeIcon(kind: ScheduleObjectType["kind"]) {
  return kind === "review" ? "◌" : kind === "live" ? "●" : "◆";
}

type ScheduleDragData =
  | { kind: "content-stage"; contentId: string; stage: WorkStage; eventId?: string }
  | { kind: "review-day"; reviewDayId: string }
  | { kind: "live-session"; liveSessionId: string }
  | { kind: "schedule-type-template"; typeId: string }
  | { kind: "schedule-object"; objectId: string };

export function ScheduleView({
  state,
  open,
  openReview,
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
  state: WorkspaceState;
  open: (id: string) => void;
  openReview: () => void;
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
  const [mode, setMode] = useState<"week" | "month">("month");
  const [anchor, setAnchor] = useState(date);
  const [liveDraft, setLiveDraft] = useState<LiveSession | null>(null);
  const [objectDraft, setObjectDraft] = useState<ScheduleObject | null>(null);
  const [typeDraft, setTypeDraft] = useState<ScheduleObjectType | null>(null);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [deleteTypeDraft, setDeleteTypeDraft] = useState<ScheduleObjectType | null>(null);
  const anchorDate = new Date(`${anchor}T12:00:00`);
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth() + 1;
  const monthDays = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const leading = (new Date(`${monthStart}T12:00:00`).getDay() + 6) % 7;
  const monthCells: Array<string | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: monthDays }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`),
  ];
  const weekStart = startOfWeekISO(anchorDate);
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const visibleDates = mode === "month" ? monthCells : weekDates;
  const periodLabel = mode === "month"
    ? `${year} 年 ${month} 月`
    : `${weekDates[0].slice(5)} — ${weekDates[6].slice(5)}`;

  const writeDrag = (event: DragEvent, data: ScheduleDragData) => {
    const value = JSON.stringify(data);
    event.dataTransfer.setData("application/x-stage-schedule", value);
    event.dataTransfer.setData("text/plain", value);
    event.dataTransfer.effectAllowed = data.kind.endsWith("template") ? "copyMove" : "move";
  };

  const scrollHorizontalRow = (event: WheelEvent<HTMLDivElement>) => {
    const row = event.currentTarget;
    if (row.scrollWidth <= row.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const maxScroll = row.scrollWidth - row.clientWidth;
    const nextScroll = Math.max(0, Math.min(maxScroll, row.scrollLeft + delta));
    if (nextScroll === row.scrollLeft) return;
    event.preventDefault();
    row.scrollLeft = nextScroll;
  };
  const readDrag = (event: DragEvent): ScheduleDragData | null => {
    const value = event.dataTransfer.getData("application/x-stage-schedule") || event.dataTransfer.getData("text/plain");
    try {
      const parsed = JSON.parse(value) as ScheduleDragData;
      if (parsed.kind === "content-stage") {
        return parsed.contentId && SCHEDULABLE_STAGES.includes(parsed.stage) ? parsed : null;
      }
      if (parsed.kind === "review-day" && parsed.reviewDayId) return parsed;
      if (parsed.kind === "live-session" && parsed.liveSessionId) return parsed;
      if (parsed.kind === "schedule-type-template" && parsed.typeId) return parsed;
      if (parsed.kind === "schedule-object" && parsed.objectId) return parsed;
      return null;
    } catch {
      return null;
    }
  };
  const movePeriod = (direction: -1 | 1) => {
    const next = new Date(`${anchor}T12:00:00`);
    if (mode === "week") next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction, 1);
    setAnchor(next.toISOString().slice(0, 10));
  };
  const pendingFor = (contentId: string, stage: WorkStage) => state.stageEvents.find(
    (event) => event.contentId === contentId && event.stage === stage && !event.completedAt,
  );
  const unscheduledContents = state.contents
    .filter((item) => item.stage !== "archived" && item.stage !== "review")
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || b.updatedAt.localeCompare(a.updatedAt));

  const openNewLive = (plannedDate: string) => {
    const timestamp = new Date().toISOString();
    setLiveDraft({
      id: crypto.randomUUID(),
      title: "",
      plannedDate,
      startTime: "20:00",
      endTime: "21:00",
      platform: state.profile.primaryPlatform,
      content: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const openNewObject = (typeId: string, plannedDate: string) => {
    const type = state.scheduleObjectTypes.find((item) => item.id === typeId);
    if (!type) return;
    const timestamp = new Date().toISOString();
    setObjectDraft({
      id: crypto.randomUUID(),
      typeId,
      title: type.name,
      plannedDate,
      startTime: "",
      endTime: "",
      details: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const openNewType = () => {
    const colors = ["#4F7A72", "#7B6D9B", "#A36A45", "#4C6F91", "#8A6B3F", "#55745A"];
    setTypeDraft({
      id: crypto.randomUUID(),
      kind: "custom",
      name: "",
      description: "",
      color: colors[state.scheduleObjectTypes.length % colors.length],
      archived: false,
      createdAt: new Date().toISOString(),
    });
  };

  const activeScheduleTypes = state.scheduleObjectTypes.filter((item) => !item.archived);
  const reviewScheduleType = state.scheduleObjectTypes.find((item) => item.kind === "review")
    || DEFAULT_SCHEDULE_OBJECT_TYPES.find((item) => item.kind === "review")!;
  const liveScheduleType = state.scheduleObjectTypes.find((item) => item.kind === "live")
    || DEFAULT_SCHEDULE_OBJECT_TYPES.find((item) => item.kind === "live")!;
  const scheduleTypeEventCount = (type: ScheduleObjectType) => type.kind === "review"
    ? state.reviewDays.length
    : type.kind === "live"
      ? state.liveSessions.length
      : state.scheduleObjects.filter((item) => item.typeId === type.id).length;

  const handleDayDrop = (data: ScheduleDragData, plannedDate: string) => {
    if (data.kind === "content-stage") {
      if (data.eventId) moveEvent(data.eventId, plannedDate);
      else schedule(data.contentId, data.stage, plannedDate);
    } else if (data.kind === "review-day") {
      moveReviewDay(data.reviewDayId, plannedDate);
    } else if (data.kind === "live-session") {
      moveLive(data.liveSessionId, plannedDate);
    } else if (data.kind === "schedule-type-template") {
      const type = activeScheduleTypes.find((item) => item.id === data.typeId);
      if (type?.kind === "review") createReviewDay(plannedDate);
      else if (type?.kind === "live") openNewLive(plannedDate);
      else if (type) openNewObject(type.id, plannedDate);
    } else {
      moveObject(data.objectId, plannedDate);
    }
  };

  const handlePoolDrop = (data: ScheduleDragData) => {
    if (data.kind === "content-stage") unschedule(data.contentId, data.stage);
  };

  const confirmRemoveLive = (session: LiveSession) => {
    if (!window.confirm(`确定删除${liveScheduleType.name}日程「${session.title}」吗？`)) return false;
    removeLive(session.id);
    return true;
  };

  const confirmRemoveObject = (object: ScheduleObject) => {
    if (!window.confirm(`确定删除日程「${object.title}」吗？`)) return false;
    removeObject(object.id);
    return true;
  };

  const renderContentEvents = (plannedDate: string) => sortStageEvents(
    state.stageEvents.filter((event) => SCHEDULABLE_STAGES.includes(event.stage) && event.plannedDate === plannedDate),
  ).map((event) => {
    const item = state.contents.find((content) => content.id === event.contentId);
    if (!item) return null;
    const isDone = Boolean(event.completedAt);
    const overdue = !isDone && plannedDate < date;
    return <article
      key={event.id}
      draggable
      onDragStart={(dragEvent) => writeDrag(dragEvent, { kind: "content-stage", contentId: item.id, stage: event.stage, eventId: event.id })}
      className={`schedule-calendar-event ${isDone ? "completed" : ""} ${overdue ? "overdue" : ""}`}
      style={{ "--stage-color": state.stageColors[event.stage] } as React.CSSProperties}
    >
      <button className="schedule-event-main" onClick={() => open(item.id)} title={`${item.title} · ${STAGE_LABELS[event.stage]}`}>
        <em>{STAGE_LABELS[event.stage]}</em><strong>{item.title}</strong>{isDone ? <i>✓</i> : null}
      </button>
      {!isDone ? <button className="schedule-event-remove" onClick={() => unschedule(item.id, event.stage)} aria-label={`取消${item.title}的${STAGE_LABELS[event.stage]}排期`}>×</button> : null}
    </article>;
  });

  const renderReviewDays = (plannedDate: string) => state.reviewDays
    .filter((item) => item.plannedDate === plannedDate)
    .map((reviewDay) => {
      const pendingCount = state.contents.filter(
        (item) => item.publicationStatus === "published" && !item.review.completedAt,
      ).length;
      return <article
        key={reviewDay.id}
        draggable
        onDragStart={(dragEvent) => writeDrag(dragEvent, { kind: "review-day", reviewDayId: reviewDay.id })}
        className="schedule-calendar-event schedule-operation-event"
        style={{ "--event-color": reviewScheduleType.color } as React.CSSProperties}
      >
        <button className="schedule-event-main schedule-operation-event-main" onClick={openReview} title={`打开${reviewScheduleType.name}实验室`}>
          <span className="schedule-operation-event-icon" aria-hidden="true">{scheduleTypeIcon(reviewScheduleType.kind)}</span>
          <span className="schedule-operation-event-copy"><em>{reviewScheduleType.name}</em><strong>{pendingCount ? `集中处理 ${pendingCount} 条待复盘` : "统一回看内容表现"}</strong></span>
        </button>
        <button className="schedule-event-remove" onClick={() => removeReviewDay(reviewDay.id)} aria-label={`取消${reviewScheduleType.name}`}>×</button>
      </article>;
    });

  const renderLiveSessions = (plannedDate: string) => state.liveSessions
    .filter((item) => item.plannedDate === plannedDate)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => <article
      key={session.id}
      draggable
      onDragStart={(dragEvent) => writeDrag(dragEvent, { kind: "live-session", liveSessionId: session.id })}
      className="schedule-calendar-event schedule-operation-event"
      style={{ "--event-color": liveScheduleType.color } as React.CSSProperties}
    >
      <button className="schedule-event-main schedule-operation-event-main" onClick={() => setLiveDraft({ ...session })} title={session.content || session.title}>
        <span className="schedule-operation-event-icon" aria-hidden="true">{scheduleTypeIcon(liveScheduleType.kind)}</span>
        <span className="schedule-operation-event-copy"><em>{liveScheduleType.name}</em><strong>{session.title}</strong></span>
        <i>{session.startTime || "待定"}</i>
      </button>
      <button className="schedule-event-remove" onClick={() => confirmRemoveLive(session)} aria-label={`删除${liveScheduleType.name}：${session.title}`}>×</button>
    </article>);

  const renderScheduleObjects = (plannedDate: string) => state.scheduleObjects
    .filter((item) => item.plannedDate === plannedDate)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((object) => {
      const type = state.scheduleObjectTypes.find((item) => item.id === object.typeId);
      if (!type) return null;
      return <article
        key={object.id}
        draggable
        onDragStart={(dragEvent) => writeDrag(dragEvent, { kind: "schedule-object", objectId: object.id })}
        className="schedule-calendar-event schedule-operation-event"
        style={{ "--event-color": type.color } as React.CSSProperties}
      >
        <button className="schedule-event-main schedule-operation-event-main" onClick={() => setObjectDraft({ ...object })} title={object.details || object.title}>
          <span className="schedule-operation-event-icon" aria-hidden="true">{scheduleTypeIcon(type.kind)}</span>
          <span className="schedule-operation-event-copy"><em>{type.name}</em><strong>{object.title}</strong></span>
          {object.startTime ? <i>{object.startTime}</i> : null}
        </button>
        <button className="schedule-event-remove" onClick={() => confirmRemoveObject(object)} aria-label={`删除${type.name}：${object.title}`}>×</button>
      </article>;
    });

  const renderDay = (plannedDate: string, compact: boolean) => {
    const day = Number(plannedDate.slice(-2));
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${plannedDate}T12:00:00`));
    return <section
      key={plannedDate}
      className={`schedule-day-cell ${plannedDate === date ? "today" : ""} ${compact ? "compact" : ""}`}
      data-date={plannedDate}
      aria-label={`${plannedDate} 档期`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); const data = readDrag(event); if (data) handleDayDrop(data, plannedDate); }}
    >
      <header><strong>{day}</strong>{!compact ? <span>{weekday}</span> : null}</header>
      <div className="schedule-day-events">{renderReviewDays(plannedDate)}{renderLiveSessions(plannedDate)}{renderScheduleObjects(plannedDate)}{renderContentEvents(plannedDate)}</div>
    </section>;
  };

  return <><div className="schedule-layout">
    <aside
      className="panel schedule-pool"
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); const data = readDrag(event); if (data) handlePoolDrop(data); }}
    >
      <div className="schedule-pool-heading"><div><span className="eyebrow">SCHEDULE POOL</span><h2>档期对象</h2></div><button className="stage-colors-button" onClick={configureColors}><span aria-hidden="true">◐</span>阶段配色</button></div>
      <p>先放运营日程，再把内容的大纲、脚本、录制、剪辑和发布拖到具体日期。</p>
      <section className="schedule-operation-pool">
        <header><div><strong>运营日程</strong><small>每个模板都可无限次拖入日历</small></div><div className="schedule-operation-actions"><span>无限次</span><button onClick={() => setShowTypeManager(true)} aria-label="管理日程类型">管理</button></div></header>
        <div className="schedule-operation-templates" onWheel={scrollHorizontalRow}>
          {activeScheduleTypes.map((type) => <button
            key={type.id}
            draggable
            className={`schedule-type-template schedule-type-${type.kind}`}
            style={{ "--event-color": type.color } as React.CSSProperties}
            onDragStart={(event) => writeDrag(event, { kind: "schedule-type-template", typeId: type.id })}
            aria-label={`拖动创建${type.name}`}
          ><span className="operation-icon">{scheduleTypeIcon(type.kind)}</span><span><strong>{type.name}</strong><small>{type.description || `安排${type.name}`}</small></span></button>)}
        </div>
      </section>
      <div className="schedule-content-section-title"><div><strong>内容阶段</strong><small>复盘不再针对单条内容排期</small></div></div>
      <div className="schedule-content-list">{unscheduledContents.map((item) => {
        const firstStage = item.stage === "inbox" ? "topic" : item.stage as WorkStage;
        const remainingStages = SCHEDULABLE_STAGES.slice(SCHEDULABLE_STAGES.indexOf(firstStage));
        const progress = Math.round(stageProgress(item.stage) * 100);
        return <article key={item.id} className="schedule-content-card" style={{ "--stage-color": state.stageColors[item.stage] } as React.CSSProperties}>
          <button className="schedule-content-heading" onClick={() => open(item.id)}>
            <div className="schedule-content-heading-row"><div className="schedule-content-badges"><Badge tone={item.stage} color={state.stageColors[item.stage]}>当前 · {STAGE_LABELS[item.stage]}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></div><span className="schedule-content-percent">{progress}%</span></div>
            <strong>{item.title}</strong>
            <span className="schedule-content-progress" aria-label={`内容完成度 ${progress}%`}><i style={{ width: `${progress}%` }} /></span>
          </button>
          <div className="schedule-stage-chips" onWheel={scrollHorizontalRow} aria-label={`${item.title}的内容阶段，可横向滚动`}>{remainingStages.map((stage) => {
            const planned = pendingFor(item.id, stage);
            return <button
              key={stage}
              draggable
              onDragStart={(event) => writeDrag(event, { kind: "content-stage", contentId: item.id, stage })}
              onClick={() => open(item.id)}
              className={`${stage === item.stage ? "current" : ""} ${planned ? "scheduled" : ""}`}
              style={{ "--stage-color": state.stageColors[stage] } as React.CSSProperties}
              title={planned ? `已安排到 ${planned.plannedDate}` : `拖动安排${STAGE_LABELS[stage]}`}
            ><span>⠿</span>{STAGE_LABELS[stage]}{planned ? <small>{planned.plannedDate.slice(5)}</small> : null}</button>;
          })}</div>
        </article>;
      })}</div>
    </aside>

    <section className="panel schedule-calendar-panel">
      <header className="schedule-toolbar"><div><span className="eyebrow">PRODUCTION CALENDAR</span><h2>{periodLabel}</h2></div><div className="schedule-toolbar-actions"><div className="segmented"><button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>周</button><button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>月</button></div><div className="calendar-nav"><button onClick={() => movePeriod(-1)} aria-label="上一档期">‹</button><button onClick={() => setAnchor(date)}>今天</button><button onClick={() => movePeriod(1)} aria-label="下一档期">›</button></div></div></header>
      <div className="schedule-legend"><span><i className="legend-content-stage" />内容阶段</span><span><i className="legend-operation-event" />运营日程</span><span>复盘、直播和自定义日程可重复创建</span><span>已有事件可继续拖动改期</span></div>
      {mode === "month" ? <><div className="schedule-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="schedule-month-grid">{visibleDates.map((plannedDate, index) => plannedDate ? renderDay(plannedDate, true) : <div key={`empty-${index}`} className="schedule-day-cell empty compact" />)}</div></> : <div className="schedule-week-scroll" onWheel={scrollHorizontalRow} tabIndex={0} aria-label="周日历，可横向滚动"><div className="schedule-week-grid">{weekDates.map((plannedDate) => renderDay(plannedDate, false))}</div></div>}
    </section>
  </div>{liveDraft ? <LiveSessionModal
    session={liveDraft}
    type={liveScheduleType}
    update={setLiveDraft}
    close={() => setLiveDraft(null)}
    save={(session) => { saveLive({ ...session, title: session.title.trim(), updatedAt: new Date().toISOString() }); setLiveDraft(null); }}
    remove={state.liveSessions.some((item) => item.id === liveDraft.id) ? () => {
      if (confirmRemoveLive(liveDraft)) setLiveDraft(null);
    } : undefined}
  /> : null}{objectDraft ? <ScheduleObjectModal
    object={objectDraft}
    type={state.scheduleObjectTypes.find((item) => item.id === objectDraft.typeId)}
    update={setObjectDraft}
    close={() => setObjectDraft(null)}
    save={(object) => { saveObject({ ...object, title: object.title.trim(), details: object.details.trim(), updatedAt: new Date().toISOString() }); setObjectDraft(null); }}
    remove={state.scheduleObjects.some((item) => item.id === objectDraft.id) ? () => {
      if (confirmRemoveObject(objectDraft)) setObjectDraft(null);
    } : undefined}
  /> : null}{showTypeManager ? <ScheduleTypeManagerModal
    types={activeScheduleTypes}
    eventCount={scheduleTypeEventCount}
    close={() => setShowTypeManager(false)}
    create={() => { setShowTypeManager(false); openNewType(); }}
    edit={(type) => { setShowTypeManager(false); setTypeDraft({ ...type }); }}
    remove={(type) => { setShowTypeManager(false); setDeleteTypeDraft(type); }}
  /> : null}{deleteTypeDraft ? <ScheduleTypeDeleteModal
    type={deleteTypeDraft}
    eventCount={scheduleTypeEventCount(deleteTypeDraft)}
    close={() => setDeleteTypeDraft(null)}
    archive={() => { archiveObjectType(deleteTypeDraft.id); setDeleteTypeDraft(null); }}
    remove={() => { removeObjectType(deleteTypeDraft.id); setDeleteTypeDraft(null); }}
  /> : null}{typeDraft ? <ScheduleTypeModal
    type={typeDraft}
    existing={state.scheduleObjectTypes.some((item) => item.id === typeDraft.id)}
    update={setTypeDraft}
    close={() => setTypeDraft(null)}
    duplicate={["复盘", "直播"].includes(typeDraft.name.trim()) || state.scheduleObjectTypes.some(
      (item) => !item.archived && item.id !== typeDraft.id && item.name.toLocaleLowerCase() === typeDraft.name.trim().toLocaleLowerCase(),
    )}
    save={(type) => { saveObjectType(type); setTypeDraft(null); }}
  /> : null}</>;
}

function LiveSessionModal({ session, type, update, close, save, remove }: {
  session: LiveSession;
  type: ScheduleObjectType;
  update: (session: LiveSession) => void;
  close: () => void;
  save: (session: LiveSession) => void;
  remove?: () => void;
}) {
  const patch = (value: Partial<LiveSession>) => update({ ...session, ...value });
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="live-session-modal schedule-object-modal" role="dialog" aria-modal="true" aria-labelledby="live-session-title" style={{ "--event-color": type.color } as React.CSSProperties}>
      <header><div><span className="eyebrow">LIVE SCHEDULE</span><h2 id="live-session-title">{remove ? `编辑${type.name}日程` : `创建${type.name}日程`}</h2><p>{type.name}是独立于内容总览的日程对象，可以随时拖动改期。</p></div><button className="close-button" onClick={close} aria-label={`关闭${type.name}日程`}>×</button></header>
      <div className="live-session-form">
        <label className="field full"><span>{type.name}主题</span><input autoFocus value={session.title} onChange={(event) => patch({ title: event.target.value })} placeholder="例如：AI 工具实战答疑" /></label>
        <div className="form-grid">
          <label className="field"><span>日期</span><input type="date" value={session.plannedDate} onChange={(event) => patch({ plannedDate: event.target.value })} /></label>
          <label className="field"><span>直播平台</span><input value={session.platform} onChange={(event) => patch({ platform: event.target.value })} placeholder="例如 小红书" /></label>
          <label className="field"><span>开始时间</span><input type="time" value={session.startTime} onChange={(event) => patch({ startTime: event.target.value })} /></label>
          <label className="field"><span>结束时间</span><input type="time" value={session.endTime} onChange={(event) => patch({ endTime: event.target.value })} /></label>
        </div>
        <label className="field full"><span>{type.name}内容 / 流程</span><textarea className="large" value={session.content} onChange={(event) => patch({ content: event.target.value })} placeholder="记录要讲的主题、演示环节、互动问题和准备事项…" /></label>
      </div>
      <footer><div>{remove ? <button className="delete-live-button" onClick={remove}>删除这条日程</button> : null}</div><div><button className="text-button" onClick={close}>取消</button><button className="primary-button" disabled={!session.title.trim() || !session.plannedDate} onClick={() => save(session)}>保存{type.name}日程</button></div></footer>
    </section>
  </div>;
}

function ScheduleObjectModal({ object, type, update, close, save, remove }: {
  object: ScheduleObject;
  type: ScheduleObjectType | undefined;
  update: (object: ScheduleObject) => void;
  close: () => void;
  save: (object: ScheduleObject) => void;
  remove?: () => void;
}) {
  const patch = (value: Partial<ScheduleObject>) => update({ ...object, ...value });
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="live-session-modal schedule-object-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-object-title" style={{ "--event-color": type?.color || "#6C7A72" } as React.CSSProperties}>
      <header><div><span className="eyebrow">CUSTOM SCHEDULE</span><h2 id="schedule-object-title">{remove ? `编辑${type?.name || "日程"}` : `创建${type?.name || "日程"}`}</h2><p>这是独立于内容总览的日程，保存后仍可在日历中拖动改期。</p></div><button className="close-button" onClick={close} aria-label="关闭自定义日程">×</button></header>
      <div className="live-session-form">
        <div className="schedule-object-type-badge"><i />{type?.name || "自定义日程"}</div>
        <label className="field full"><span>标题</span><input autoFocus value={object.title} onChange={(event) => patch({ title: event.target.value })} placeholder={`例如：${type?.name || "线下活动"}`} /></label>
        <div className="form-grid">
          <label className="field"><span>日期</span><input type="date" value={object.plannedDate} onChange={(event) => patch({ plannedDate: event.target.value })} /></label>
          <div />
          <label className="field"><span>开始时间（可选）</span><input type="time" value={object.startTime} onChange={(event) => patch({ startTime: event.target.value })} /></label>
          <label className="field"><span>结束时间（可选）</span><input type="time" value={object.endTime} onChange={(event) => patch({ endTime: event.target.value })} /></label>
        </div>
        <label className="field full"><span>备注</span><textarea className="large" value={object.details} onChange={(event) => patch({ details: event.target.value })} placeholder="记录地点、流程、需要准备的材料等…" /></label>
      </div>
      <footer><div>{remove ? <button className="delete-live-button" onClick={remove}>删除这个日程</button> : null}</div><div><button className="text-button" onClick={close}>取消</button><button className="primary-button" disabled={!type || !object.title.trim() || !object.plannedDate} onClick={() => save(object)}>保存日程</button></div></footer>
    </section>
  </div>;
}

function ScheduleTypeModal({ type, existing, update, close, save, duplicate }: {
  type: ScheduleObjectType;
  existing: boolean;
  update: (type: ScheduleObjectType) => void;
  close: () => void;
  save: (type: ScheduleObjectType) => void;
  duplicate: boolean;
}) {
  const patch = (value: Partial<ScheduleObjectType>) => update({ ...type, ...value });
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="live-session-modal schedule-type-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-type-title" style={{ "--event-color": type.color } as React.CSSProperties}>
      <header><div><span className="eyebrow">REUSABLE SCHEDULE</span><h2 id="schedule-type-title">{existing ? "编辑日程类型" : "新建日程类型"}</h2><p>{existing ? "修改后会同步到模板和已经安排的日历事件。" : "创建一次，就会留在档期对象中，可以无限次拖入日历。"}</p></div><button className="close-button" onClick={close} aria-label={`关闭${existing ? "编辑" : "新建"}日程类型`}>×</button></header>
      <div className="live-session-form">
        <label className="field full"><span>类型名称</span><input autoFocus maxLength={10} value={type.name} onChange={(event) => patch({ name: event.target.value })} placeholder="例如：活动" />{duplicate ? <small className="field-error">这个名称已经存在</small> : null}</label>
        <label className="field full"><span>一句话说明（可选）</span><input maxLength={40} value={type.description} onChange={(event) => patch({ description: event.target.value })} placeholder="例如：线下活动、展会或特别安排" /></label>
        <label className="schedule-type-color-field"><span>识别颜色</span><div><i style={{ background: type.color }} /><code>{type.color.toUpperCase()}</code><input type="color" value={type.color} onChange={(event) => patch({ color: event.target.value.toUpperCase() })} aria-label="日程类型颜色" /></div></label>
        <div className="schedule-type-preview"><span className="operation-icon">{scheduleTypeIcon(type.kind)}</span><span><strong>{type.name.trim() || "新类型"}</strong><small>{type.description.trim() || "拖入日历后创建具体日程"}</small></span></div>
      </div>
      <footer><div /><div><button className="text-button" onClick={close}>取消</button><button className="primary-button" disabled={!type.name.trim() || duplicate} onClick={() => save(type)}>{existing ? "保存修改" : "创建类型"}</button></div></footer>
    </section>
  </div>;
}

function ScheduleTypeManagerModal({ types, eventCount, close, create, edit, remove }: {
  types: ScheduleObjectType[];
  eventCount: (type: ScheduleObjectType) => number;
  close: () => void;
  create: () => void;
  edit: (type: ScheduleObjectType) => void;
  remove: (type: ScheduleObjectType) => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="live-session-modal schedule-type-manager-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-type-manager-title">
      <header><div><span className="eyebrow">SCHEDULE TYPES</span><h2 id="schedule-type-manager-title">管理日程类型</h2><p>复盘、直播和自定义类型都在这里统一修改或删除。</p></div><button className="close-button" onClick={close} aria-label="关闭管理日程类型">×</button></header>
      <div className="schedule-type-manager-list">{types.length ? types.map((type) => {
        const count = eventCount(type);
        return <article key={type.id} style={{ "--event-color": type.color } as React.CSSProperties}>
          <span className="schedule-type-manager-icon">{type.kind === "review" ? "◌" : type.kind === "live" ? "●" : "◆"}</span>
          <div><strong>{type.name}</strong><small>{type.description || "暂无说明"} · {count ? `${count} 条已排日程` : "暂无已排日程"}</small></div>
          <button onClick={() => edit(type)}>编辑</button>
          <button className="schedule-type-remove-button" onClick={() => remove(type)}>删除</button>
        </article>;
      }) : <Empty title="还没有自定义日程类型" body="创建“活动、拍摄”等模板后，可以在这里统一管理。" />}</div>
      <footer><div /><div><button className="text-button" onClick={close}>关闭</button><button className="primary-button" onClick={create}>＋ 新建类型</button></div></footer>
    </section>
  </div>;
}

function ScheduleTypeDeleteModal({ type, eventCount, close, archive, remove }: {
  type: ScheduleObjectType;
  eventCount: number;
  close: () => void;
  archive: () => void;
  remove: () => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="live-session-modal schedule-type-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="schedule-type-delete-title">
      <header><div><span className="eyebrow">DELETE SCHEDULE TYPE</span><h2 id="schedule-type-delete-title">删除“{type.name}”类型？</h2><p>{eventCount ? `这个类型下还有 ${eventCount} 条已排日程，请选择如何处理。` : "这个类型下没有已排日程，可以直接删除。"}</p></div><button className="close-button" onClick={close} aria-label="关闭删除日程类型">×</button></header>
      <div className={`schedule-type-delete-options ${eventCount ? "" : "single"}`}>
        {eventCount ? <button onClick={archive}><strong>只删除模板</strong><small>从档期对象中移除，但保留日历里的 {eventCount} 条日程。</small></button> : null}
        <button className="destructive" onClick={remove}><strong>{eventCount ? "模板和日程一起删除" : "删除这个类型"}</strong><small>{eventCount ? `同时删除 ${eventCount} 条已排日程，此操作不可撤销。` : "删除后将不再出现在档期对象中。"}</small></button>
      </div>
      <footer><div /><div><button className="text-button" onClick={close}>取消</button></div></footer>
    </section>
  </div>;
}
