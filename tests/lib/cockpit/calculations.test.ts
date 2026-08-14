import { describe, it, expect } from 'vitest';
import {
  calculateGoalHealth,
  currentFollowers,
  isQualityQualified,
  publishedWithin,
  qualifiedContents,
  startOfWeekISO,
} from '@/lib/cockpit/calculations';
import { DEFAULT_CREATOR_PROFILE, DEFAULT_DESIGN_STYLE, DEFAULT_NAVIGATION_ORDER, DEFAULT_PAGE_TITLES, DEFAULT_SCHEDULE_OBJECT_TYPES, DEFAULT_STAGE_COLORS, type ContentItem, type GoalCycle, type LiveSession, type ScheduleObject, type ScheduleObjectType, type StageEvent, type WorkspaceState } from '@/lib/cockpit/model';
import { migrateWorkspace } from '@/lib/cockpit/migrations';
import {
  addReviewDay,
  archiveScheduleObjectType,
  moveLiveSession,
  moveReviewDay,
  removeLiveSession,
  removeReviewDay,
  moveScheduleObject,
  removeScheduleObject,
  removeScheduleObjectType,
  saveScheduleObject,
  saveScheduleObjectType,
  saveLiveSession,
} from '@/lib/cockpit/schedule';
import { completeContentReview, deleteContentFromWorkspace } from '@/lib/cockpit/workspace';
import {
  canScheduleStage,
  completedPublishingEvents,
  moveStageEventToDate,
  overdueStageEvents,
  removeStageEvent,
  scheduleStageForDate,
  setContentStageCompletion,
  sortStageEvents,
  stageProgress,
  toggleStageEvent,
  transitionContentStage,
} from '@/lib/cockpit/workflow';

const goal: GoalCycle = {
  id: "q3",
  objective: "稳定产出",
  startDate: "2026-07-01",
  endDate: "2026-09-30",
  status: "active",
  outputTarget: 4,
  quotas: [{ contentType: "AI 产品实测", target: 4 }],
  followerStart: 100,
  followerTarget: 200,
  qualityMetric: "saveRate",
  qualityThreshold: 5,
  qualityTarget: 2,
};

function content(partial: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "content-1",
    title: "测试内容",
    idea: "",
    contentType: "AI 产品实测",
    tier: "B",
    platform: "douyin",
    stage: "review",
    publicationStatus: "published",
    priority: "normal",
    tags: [],
    createdAt: "2026-07-01",
    updatedAt: "2026-07-01",
    publishedAt: "2026-07-10",
    xhsLink: "",
    coverCopy: "",
    publishCopy: "",
    topic: {
      audience: "", painPoint: "", pointOfView: "", commonAngle: "", contrastAngle: "", assets: "", minimumProduction: "",
      score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
    },
    script: { headline: "", hook: "", conclusion: "", body: "", example: "", ending: "" },
    recordingNotes: "",
    editingNotes: "",
    metrics: { views: 1_000, likes: 60, saves: 60, comments: 10, followerGain: 20, capturedAt: "2026-07-13" },
    review: { rating: 0, analysis: "", learnedRule: "", completedAt: "" },
    ...partial,
  };
}

function workspace(item = content(), events: StageEvent[] = []): WorkspaceState {
  return {
    schemaVersion: 16,
    designStyle: DEFAULT_DESIGN_STYLE,
    navigationOrder: [...DEFAULT_NAVIGATION_ORDER],
    profile: { ...DEFAULT_CREATOR_PROFILE },
    pageTitles: { ...DEFAULT_PAGE_TITLES },
    setupComplete: true,
    lastBackupAt: "",
    inspirationCards: [],
    contents: [item],
    stageEvents: events,
    reviewDays: [],
    liveSessions: [],
    scheduleObjectTypes: DEFAULT_SCHEDULE_OBJECT_TYPES.map((type) => ({ ...type })),
    scheduleObjects: [],
    stageColors: { ...DEFAULT_STAGE_COLORS },
    goal,
    goalHistory: [],
    followerSnapshots: [],
    insightRules: [],
    contentTypes: ["AI 产品实测"],
  };
}

describe('calculations', () => {
  it("published records are counted once and respect quarter boundaries", () => {
    const records = [
      content(),
      content({ id: "outside", publishedAt: "2026-10-01" }),
      content({ id: "draft", publicationStatus: "draft" }),
    ];
    expect(publishedWithin(records, goal.startDate, goal.endDate).length).toBe(1);
    expect(publishedWithin([content({ publishedAt: "2026-09-30" })], goal.startDate, goal.endDate).length).toBe(1);
    expect(publishedWithin([content({ publicationStatus: "draft" })], goal.startDate, goal.endDate).length).toBe(0);
  });

  it("quality KR only counts snapshots captured at T+3 or later", () => {
    const early = content({ metrics: { views: 1_000, likes: 60, saves: 60, comments: 10, followerGain: 20, capturedAt: "2026-07-12" } });
    expect(isQualityQualified(early, goal)).toBe(false);
    expect(isQualityQualified(content(), goal)).toBe(true);
    expect(qualifiedContents([early, content()], goal).map((item) => item.id)).toEqual(["content-1"]);
  });

  it("follower snapshots are sorted before growth is calculated", () => {
    const followers = currentFollowers(goal, [
      { date: "2026-07-20", followers: 145 },
      { date: "2026-07-03", followers: 112 },
      { date: "2026-10-01", followers: 999 },
    ]);
    expect(followers).toBe(145);
    const health = calculateGoalHealth(goal, [content()], [{ date: "2026-07-20", followers: 145 }], new Date("2026-07-20T20:00:00"));
    expect(health.outputRemaining).toBe(3);
    expect(health.followerRemaining).toBe(55);
  });

  it("quarter setup rhythm and Shanghai week boundaries remain correct", () => {
    const health = calculateGoalHealth(goal, [], [], new Date("2026-07-03T23:00:00"));
    expect(health.status).toBe("setting_up");
    expect(Math.round(health.timeProgress * 92)).toBe(3);
    expect(startOfWeekISO(new Date("2026-07-19T16:30:00.000Z"))).toBe("2026-07-20");
  });

  it("completed Todo events sink while undo restores original ordering", () => {
    const events: StageEvent[] = [
      { id: "first", contentId: "first", stage: "script", plannedDate: "2026-07-18", rank: 1, completedAt: "" },
      { id: "second", contentId: "second", stage: "script", plannedDate: "2026-07-18", rank: 2, completedAt: "2026-07-18T09:00:00.000Z" },
      { id: "third", contentId: "third", stage: "script", plannedDate: "2026-07-18", rank: 3, completedAt: "" },
    ];
    expect(sortStageEvents(events).map((item) => item.id)).toEqual(["first", "third", "second"]);
    expect(sortStageEvents(events.map((event) => event.id === "second" ? { ...event, completedAt: "" } : event)).map((item) => item.id)).toEqual(["first", "second", "third"]);
  });

  it("today view keeps only unfinished overdue Todo events above today's list", () => {
    const events: StageEvent[] = [
      { id: "older", contentId: "first", stage: "script", plannedDate: "2026-07-20", rank: 2, completedAt: "" },
      { id: "earlier-rank", contentId: "second", stage: "recording", plannedDate: "2026-07-20", rank: 1, completedAt: "" },
      { id: "completed", contentId: "third", stage: "editing", plannedDate: "2026-07-19", rank: 1, completedAt: "2026-07-19T09:00:00.000Z" },
      { id: "today", contentId: "fourth", stage: "publishing", plannedDate: "2026-07-25", rank: 1, completedAt: "" },
      { id: "future", contentId: "fifth", stage: "topic", plannedDate: "2026-07-26", rank: 1, completedAt: "" },
      { id: "review", contentId: "sixth", stage: "review", plannedDate: "2026-07-18", rank: 1, completedAt: "" },
    ];
    expect(overdueStageEvents(events, "2026-07-25").map((event) => event.id)).toEqual(["earlier-rank", "older"]);
  });

  it("completing a Todo stage advances global stage and can be undone", () => {
    const item = content({ stage: "script", publicationStatus: "draft", publishedAt: "" });
    const event: StageEvent = { id: "event-1", contentId: item.id, stage: "script", plannedDate: "2026-07-18", rank: 1, completedAt: "" };
    const completed = toggleStageEvent(workspace(item, [event]), event.id, "2026-07-18T09:00:00.000Z");
    expect(completed.contents[0].stage).toBe("recording");
    expect(completed.stageEvents[0].completedAt).toBeTruthy();
    const restored = toggleStageEvent(completed, event.id, "unused");
    expect(restored.contents[0].stage).toBe("script");
    expect(restored.stageEvents[0].completedAt).toBe("");
    expect(stageProgress("script")).toBe(0.3);
    expect(stageProgress("recording")).toBe(0.5);
    expect(stageProgress("review")).toBe(0.95);
    expect(stageProgress("archived")).toBe(1);
  });

  it("repeated Todo completion and undo never removes later scheduled stages", () => {
    const item = content({ stage: "script", publicationStatus: "draft", publishedAt: "" });
    const events: StageEvent[] = [
      { id: "script-today", contentId: item.id, stage: "script", plannedDate: "2026-07-18", rank: 1, completedAt: "" },
      { id: "recording-today", contentId: item.id, stage: "recording", plannedDate: "2026-07-18", rank: 2, completedAt: "" },
      { id: "editing-today", contentId: item.id, stage: "editing", plannedDate: "2026-07-18", rank: 3, completedAt: "" },
    ];
    const firstCompleted = toggleStageEvent(workspace(item, events), "script-today", "2026-07-18T09:00:00.000Z");
    const firstUndone = toggleStageEvent(firstCompleted, "script-today", "unused");
    const secondCompleted = toggleStageEvent(firstUndone, "script-today", "2026-07-18T09:05:00.000Z");
    const secondUndone = toggleStageEvent(secondCompleted, "script-today", "unused");

    expect(secondUndone.contents[0].stage).toBe("script");
    expect(secondUndone.stageEvents.map((event) => [event.id, event.completedAt])).toEqual([
      ["script-today", ""],
      ["recording-today", ""],
      ["editing-today", ""],
    ]);
  });

  it("stage scheduling reschedules one shared event and updates publishing status", () => {
    const item = content({ stage: "recording", publicationStatus: "draft", publishedAt: "" });
    const first = scheduleStageForDate(workspace(item), item.id, "recording", "2026-07-20");
    const moved = scheduleStageForDate(first, item.id, "recording", "2026-07-22");
    expect(moved.stageEvents.length).toBe(1);
    expect(moved.stageEvents[0].plannedDate).toBe("2026-07-22");
    const publishing = scheduleStageForDate(moved, item.id, "publishing", "2026-07-25");
    expect(publishing.contents[0].publicationStatus).toBe("scheduled");
    const removed = removeStageEvent(publishing, publishing.stageEvents.find((event) => event.stage === "publishing")!.id);
    expect(removed.contents[0].publicationStatus).toBe("draft");
  });

  it("inspiration stays in the pipeline and never creates a calendar event", () => {
    const item = content({ stage: "inbox", publicationStatus: "draft", publishedAt: "" });
    const state = workspace(item);
    expect(canScheduleStage(state, item.id, "inbox", "2026-07-20")).toBe(false);
    expect(scheduleStageForDate(state, item.id, "inbox", "2026-07-20").stageEvents.length).toBe(0);
    const promoted = transitionContentStage(state, item.id, "topic", "2026-07-20");
    expect(promoted.contents[0].stage).toBe("topic");
    expect(promoted.stageEvents.length).toBe(0);
  });

  // 九期: 平台阶段流——canScheduleStage 是「今日推进」任务生成的唯一入口闸门
  // (scheduleStageForDate/moveStageEventToDate 都先过它), 小红书没有录制/剪辑
  // 环节, 这两个阶段永远不该产出可排期的任务；douyin (走 DEFAULT_STAGE_FLOW)
  // 行为保持不变, 用同一组断言对照验证没有误伤默认平台流。
  it("xiaohongshu 卡片不产出录制/剪辑任务, douyin 不受影响", () => {
    const xhsItem = content({ id: "xhs-1", platform: "xiaohongshu", stage: "script", publicationStatus: "draft", publishedAt: "" });
    const xhsState = workspace(xhsItem);
    expect(canScheduleStage(xhsState, xhsItem.id, "recording", "2026-07-20")).toBe(false);
    expect(canScheduleStage(xhsState, xhsItem.id, "editing", "2026-07-20")).toBe(false);
    expect(scheduleStageForDate(xhsState, xhsItem.id, "recording", "2026-07-20").stageEvents.length).toBe(0);
    expect(scheduleStageForDate(xhsState, xhsItem.id, "editing", "2026-07-20").stageEvents.length).toBe(0);
    // 流内阶段不受影响：topic/script/publishing 仍可正常排期。
    expect(canScheduleStage(xhsState, xhsItem.id, "script", "2026-07-20")).toBe(true);
    expect(canScheduleStage(xhsState, xhsItem.id, "publishing", "2026-07-25")).toBe(true);

    const douyinItem = content({ id: "douyin-1", platform: "douyin", stage: "script", publicationStatus: "draft", publishedAt: "" });
    const douyinState = workspace(douyinItem);
    expect(canScheduleStage(douyinState, douyinItem.id, "recording", "2026-07-20")).toBe(true);
    expect(canScheduleStage(douyinState, douyinItem.id, "editing", "2026-07-20")).toBe(true);
    expect(scheduleStageForDate(douyinState, douyinItem.id, "recording", "2026-07-20").stageEvents.length).toBe(1);
  });

  it("manual stage completion cascades backward and undo cascades forward", () => {
    const item = content({ stage: "topic", publicationStatus: "draft", publishedAt: "" });
    const completed = setContentStageCompletion(
      workspace(item),
      item.id,
      "editing",
      true,
      "2026-07-20",
      "2026-07-20T09:00:00.000Z",
    );
    expect(completed.contents[0].stage).toBe("publishing");
    expect(completed.stageEvents.map((event) => [event.stage, Boolean(event.completedAt)])).toEqual([
      ["topic", true],
      ["script", true],
      ["recording", true],
      ["editing", true],
    ]);
    const undone = setContentStageCompletion(
      completed,
      item.id,
      "recording",
      false,
      "2026-07-21",
      "unused",
    );
    expect(undone.contents[0].stage).toBe("recording");
    expect(undone.stageEvents.map((event) => [event.stage, Boolean(event.completedAt)])).toEqual([
      ["topic", true],
      ["script", true],
      ["recording", false],
      ["editing", false],
    ]);
  });

  it("completed calendar events remain draggable and keep completion state", () => {
    const item = content({ stage: "publishing", publicationStatus: "scheduled", publishedAt: "" });
    const planned = scheduleStageForDate(workspace(item), item.id, "publishing", "2026-07-25");
    const published = setContentStageCompletion(
      planned,
      item.id,
      "publishing",
      true,
      "2026-07-20",
      "2026-07-20T09:00:00.000Z",
    );
    const publishingEvent = published.stageEvents.find((event) => event.stage === "publishing")!;
    expect(published.contents[0].publicationStatus).toBe("published");
    expect(published.contents[0].publishedAt).toBe("2026-07-20");
    expect(published.stageEvents.some((event) => event.stage === "review")).toBe(false);
    const moved = moveStageEventToDate(published, publishingEvent.id, "2026-07-21");
    expect(moved.stageEvents.find((event) => event.id === publishingEvent.id)?.plannedDate).toBe("2026-07-21");
    expect(moved.stageEvents.find((event) => event.id === publishingEvent.id)?.completedAt).toBeTruthy();
    expect(moved.contents[0].publishedAt).toBe("2026-07-21");
    expect(moved.stageEvents.some((event) => event.stage === "review")).toBe(false);
  });

  it("stage scheduling enforces order but allows consecutive stages on the same day", () => {
    const item = content({ stage: "recording", publicationStatus: "draft", publishedAt: "" });
    const withRecording = scheduleStageForDate(workspace(item), item.id, "recording", "2026-07-22");
    expect(canScheduleStage(withRecording, item.id, "editing", "2026-07-21")).toBe(false);
    expect(canScheduleStage(withRecording, item.id, "editing", "2026-07-22")).toBe(true);
    const invalid = scheduleStageForDate(withRecording, item.id, "editing", "2026-07-21");
    expect(invalid.stageEvents.length).toBe(1);
    const sameDay = scheduleStageForDate(withRecording, item.id, "editing", "2026-07-22");
    expect(sameDay.stageEvents.map((event) => event.stage)).toEqual(["recording", "editing"]);
  });

  it("publishing creates only a completed publish event", () => {
    const item = content({ stage: "review", publicationStatus: "published", publishedAt: "2026-07-20" });
    const events = completedPublishingEvents(workspace(item), item, "2026-07-20T12:00:00.000Z");
    expect(events.map((event) => [event.stage, event.plannedDate, Boolean(event.completedAt)])).toEqual([
      ["publishing", "2026-07-20", true],
    ]);
  });

  it("saving a valid review marks it reviewed without creating a calendar stage", () => {
    const item = content({
      review: { rating: 4, analysis: "场景具体，但开头还可以更快。", learnedRule: "", completedAt: "" },
    });
    const next = completeContentReview(
      workspace(item),
      item.id,
      "2026-07-13",
      "2026-07-13T12:00:00.000Z",
    );
    expect(next.contents[0].review.completedAt).toBe("2026-07-13T12:00:00.000Z");
    expect(next.contents[0].stage).toBe("archived");
    expect(next.stageEvents.some((event) => event.stage === "review")).toBe(false);
  });

  it("review completion requires both a star rating and written analysis", () => {
    const item = content({ review: { rating: 0, analysis: "", learnedRule: "", completedAt: "" } });
    const state = workspace(item);
    expect(completeContentReview(state, item.id, "2026-07-13", "2026-07-13T12:00:00.000Z")).toBe(state);
    const unpublished = content({
      publicationStatus: "scheduled",
      publishedAt: "",
      review: { rating: 4, analysis: "已经写好，但内容还没发布。", learnedRule: "", completedAt: "" },
    });
    const unpublishedState = workspace(unpublished);
    expect(completeContentReview(unpublishedState, unpublished.id, "2026-07-13", "2026-07-13T12:00:00.000Z")).toBe(unpublishedState);
  });

  it("review days can be created repeatedly, moved, and removed independently", () => {
    const first = addReviewDay(workspace(), "2026-07-20", "2026-07-18T12:00:00.000Z");
    const second = addReviewDay(first, "2026-07-20", "2026-07-18T12:01:00.000Z");
    expect(second.reviewDays.length).toBe(2);
    expect(second.reviewDays[0].id).not.toBe(second.reviewDays[1].id);
    const moved = moveReviewDay(second, second.reviewDays[0].id, "2026-07-22");
    expect(moved.reviewDays.find((item) => item.id === second.reviewDays[0].id)?.plannedDate).toBe("2026-07-22");
    const removed = removeReviewDay(moved, second.reviewDays[1].id);
    expect(removed.reviewDays.map((item) => item.id)).toEqual([second.reviewDays[0].id]);
  });

  it("live sessions are separate records that keep details when dragged", () => {
    const session: LiveSession = {
      id: "live-1",
      title: "AI 工具答疑",
      plannedDate: "2026-07-20",
      startTime: "20:00",
      endTime: "21:00",
      platform: "小红书",
      content: "演示工具并回答问题",
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    };
    const saved = saveLiveSession(workspace(), session);
    expect(saved.liveSessions).toEqual([session]);
    const moved = moveLiveSession(saved, session.id, "2026-07-23", "2026-07-19T12:00:00.000Z");
    expect(moved.liveSessions[0].plannedDate).toBe("2026-07-23");
    expect(moved.liveSessions[0].content).toBe(session.content);
    const removed = removeLiveSession(moved, session.id);
    expect(removed.liveSessions).toEqual([]);
  });

  it("custom schedule templates can create unlimited independent events", () => {
    const type: ScheduleObjectType = {
      id: "schedule-type-event",
      kind: "custom",
      name: "活动",
      description: "线下活动或展会",
      color: "#4F7A72",
      archived: false,
      createdAt: "2026-07-18T12:00:00.000Z",
    };
    const withType = saveScheduleObjectType(workspace(), type);
    expect(withType.scheduleObjectTypes).toEqual([...DEFAULT_SCHEDULE_OBJECT_TYPES, type]);
    expect(saveScheduleObjectType(withType, { ...type, id: "duplicate-type" })).toBe(withType);
    expect(saveScheduleObjectType(withType, { ...type, id: "builtin-type", name: "复盘" })).toBe(withType);
    const first: ScheduleObject = {
      id: "schedule-object-1",
      typeId: type.id,
      title: "线下探展",
      plannedDate: "2026-07-20",
      startTime: "10:00",
      endTime: "16:00",
      details: "提前准备采访清单",
      createdAt: "2026-07-18T12:01:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    };
    const second = { ...first, id: "schedule-object-2", title: "创作者交流会", startTime: "19:00" };
    const saved = saveScheduleObject(saveScheduleObject(withType, first), second);
    expect(saved.scheduleObjects.length).toBe(2);
    expect(saved.scheduleObjects[0].id).not.toBe(saved.scheduleObjects[1].id);
    const moved = moveScheduleObject(saved, first.id, "2026-07-22", "2026-07-19T12:00:00.000Z");
    expect(moved.scheduleObjects.find((item) => item.id === first.id)?.plannedDate).toBe("2026-07-22");
    expect(moved.scheduleObjects.find((item) => item.id === first.id)?.details).toBe(first.details);
    const removed = removeScheduleObject(moved, second.id);
    expect(removed.scheduleObjects.map((item) => item.id)).toEqual([first.id]);

    const archived = archiveScheduleObjectType(saved, type.id);
    expect(archived.scheduleObjectTypes.find((item) => item.id === type.id)?.archived).toBe(true);
    expect(archived.scheduleObjects.length).toBe(2);
    const deleted = removeScheduleObjectType(saved, type.id);
    expect(deleted.scheduleObjectTypes).toEqual(DEFAULT_SCHEDULE_OBJECT_TYPES);
    expect(deleted.scheduleObjects).toEqual([]);
  });

  it("review and live use the same editable and removable type model", () => {
    const reviewType = workspace().scheduleObjectTypes.find((item) => item.kind === "review")!;
    const renamed = saveScheduleObjectType(workspace(), { ...reviewType, name: "集中复盘", color: "#725A70" });
    expect(renamed.scheduleObjectTypes.find((item) => item.kind === "review")?.name).toBe("集中复盘");
    expect(renamed.scheduleObjectTypes.find((item) => item.kind === "review")?.color).toBe("#725A70");

    const withReviewDay = addReviewDay(renamed, "2026-07-20", "2026-07-18T12:00:00.000Z");
    const hidden = archiveScheduleObjectType(withReviewDay, reviewType.id);
    expect(hidden.scheduleObjectTypes.find((item) => item.kind === "review")?.archived).toBe(true);
    expect(hidden.reviewDays.length).toBe(1);
    const deleted = removeScheduleObjectType(withReviewDay, reviewType.id);
    expect(deleted.scheduleObjectTypes.find((item) => item.kind === "review")?.archived).toBe(true);
    expect(deleted.reviewDays).toEqual([]);
  });

  it("deleting content clears its schedule and insight references", () => {
    const state: WorkspaceState = {
      ...workspace(),
      inspirationCards: [{
        id: "source-idea",
        text: "先记录一个想法。",
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
        convertedContentIds: ["content-1", "keep"],
      }],
      contents: [content(), content({ id: "keep" })],
      stageEvents: [
        { id: "delete-event", contentId: "content-1", stage: "publishing", plannedDate: "2026-07-13", rank: 0, completedAt: "" },
        { id: "keep-event", contentId: "keep", stage: "publishing", plannedDate: "2026-07-13", rank: 0, completedAt: "" },
      ],
      insightRules: [
        { id: "delete-rule", text: "删除", sourceContentId: "content-1", createdAt: "2026-07-13", active: true },
        { id: "keep-rule", text: "保留", sourceContentId: "keep", createdAt: "2026-07-13", active: true },
      ],
    };
    const next = deleteContentFromWorkspace(state, "content-1");
    expect(next.contents.map((item) => item.id)).toEqual(["keep"]);
    expect(next.insightRules.map((rule) => rule.id)).toEqual(["keep-rule"]);
    expect(next.stageEvents.map((event) => event.id)).toEqual(["keep-event"]);
    expect(next.inspirationCards[0].convertedContentIds).toEqual(["keep"]);
  });

  it("legacy workspaces migrate dates into stage events and discard weekly planning", () => {
    const legacyContent = {
      ...content({ stage: "script", publicationStatus: "scheduled", publishedAt: "" }),
      stage: "production",
      productionState: "editing",
      productionNotes: "旧版制作备注",
      todayRank: 2,
      todayPlanDate: "2026-07-18",
      todayCompletedAt: "",
      targetPublishAt: "2026-07-22",
      reviewDueAt: "",
      review: {
        diagnosis: "表达",
        audienceSignal: "观众都在追问模板",
        selfJudgment: "开头不够具体。",
        nextAction: "做系列",
        learnedRule: "先展示最终结果。",
      },
    };
    const migrated = migrateWorkspace({
      schemaVersion: 3,
      setupComplete: true,
      lastBackupAt: "",
      contents: [legacyContent],
      stageEvents: [
        { id: "legacy-inbox-event", contentId: legacyContent.id, stage: "inbox", plannedDate: "2026-07-17", rank: 1, completedAt: "" },
      ],
      goal,
      goalHistory: [],
      weeklyPlans: [{ id: "legacy-week" }],
      monthlyReviews: [],
      followerSnapshots: [],
      insightRules: [],
      contentTypes: ["AI 产品实测"],
    });
    expect(migrated?.schemaVersion).toBe(16);
    expect(migrated?.designStyle).toBe("editorial");
    expect(migrated?.navigationOrder).toEqual(DEFAULT_NAVIGATION_ORDER);
    expect(migrated?.inspirationCards).toEqual([]);
    expect(migrated?.profile.dashboardTitle).toBe("示例创作者的内容工作台");
    expect(migrated?.pageTitles.goals).toBe(goal.objective);
    expect(migrated?.stageColors.recording).toBe(DEFAULT_STAGE_COLORS.recording);
    expect(migrated?.contents[0].stage).toBe("editing");
    expect("targetPublishAt" in (migrated?.contents[0] ?? {})).toBe(false);
    expect("weeklyPlans" in (migrated ?? {})).toBe(false);
    expect(migrated?.stageEvents.map((event) => [event.stage, event.plannedDate])).toEqual([
      ["editing", "2026-07-18"],
      ["publishing", "2026-07-22"],
    ]);
    expect(migrated?.contents[0].recordingNotes).toBe("旧版制作备注");
    expect(migrated?.contents[0].editingNotes).toBe("旧版制作备注");
    expect(migrated?.contents[0].review.rating).toBe(0);
    expect(migrated?.contents[0].review.analysis).toMatch(/开头不够具体/);
    expect(migrated?.contents[0].review.analysis).toMatch(/评论信号：观众都在追问模板/);
    expect(migrated?.contents[0].review.learnedRule).toBe("先展示最终结果。");
    expect(migrated?.contents[0].review.completedAt).toBe("");
    expect(migrated?.reviewDays).toEqual([]);
    expect(migrated?.liveSessions).toEqual([]);
    expect(migrated?.scheduleObjectTypes).toEqual(DEFAULT_SCHEDULE_OBJECT_TYPES);
    expect(migrated?.scheduleObjects).toEqual([]);
  });

  it("pending legacy per-content review dates are removed from the calendar", () => {
    const item = content({ stage: "review", review: { rating: 0, analysis: "", learnedRule: "", completedAt: "" } });
    const migrated = migrateWorkspace({
      ...workspace(item, [
        { id: "pending-review-a", contentId: item.id, stage: "review", plannedDate: "2026-07-24", rank: 0, completedAt: "" },
        { id: "pending-review-b", contentId: "another-content", stage: "review", plannedDate: "2026-07-24", rank: 1, completedAt: "" },
      ]),
      schemaVersion: 9,
    });
    expect(migrated?.stageEvents.map((event) => event.stage)).toEqual(["publishing"]);
    expect(migrated?.stageEvents.some((event) => event.stage === "review")).toBe(false);
    expect(migrated?.reviewDays).toEqual([]);
  });

  it("archived legacy content is recognized as reviewed", () => {
    const item = content({
      stage: "archived",
      review: { rating: 5, analysis: "表现稳定。", learnedRule: "保持具体场景。", completedAt: "" },
    });
    const migrated = migrateWorkspace({
      ...workspace(item, [{ id: "completed-review", contentId: item.id, stage: "review", plannedDate: "2026-07-13", rank: 0, completedAt: "2026-07-13T12:00:00.000Z" }]),
      schemaVersion: 7,
    });
    expect(migrated?.schemaVersion).toBe(16);
    expect(migrated?.contents[0].review.completedAt).toBe("2026-07-13T12:00:00.000Z");
    expect(migrated?.stageEvents.some((event) => event.stage === "review")).toBe(false);
  });

  it("creator profile survives backup migration", () => {
    const restored = migrateWorkspace({
      ...workspace(),
      profile: {
        creatorName: "Mia",
        dashboardTitle: "Mia 的视频工作室",
        primaryPlatform: "B站",
        contentFocus: "设计与效率",
      },
    });
    expect(restored?.profile).toEqual({
      creatorName: "Mia",
      dashboardTitle: "Mia 的视频工作室",
      primaryPlatform: "B站",
      contentFocus: "设计与效率",
    });
  });

  it("design style survives backup migration and old backups use the default", () => {
    const styled = migrateWorkspace({
      ...workspace(),
      schemaVersion: 15,
      designStyle: "retro",
    });
    expect(styled?.designStyle).toBe("retro");

    const legacy = migrateWorkspace({
      ...workspace(),
      schemaVersion: 14,
      designStyle: undefined,
    });
    expect(legacy?.designStyle).toBe("editorial");
  });

  it("custom navigation order survives migration and invalid entries are repaired", () => {
    const restored = migrateWorkspace({
      ...workspace(),
      navigationOrder: ["review", "inspirations", "review", "unknown", "schedule"],
    });
    expect(restored?.navigationOrder).toEqual([
      "review",
      "inspirations",
      "schedule",
      "momentum",
      "pipeline",
      "goals",
    ]);

    const legacy = migrateWorkspace({
      ...workspace(),
      schemaVersion: 15,
      navigationOrder: undefined,
    });
    expect(legacy?.navigationOrder).toEqual(DEFAULT_NAVIGATION_ORDER);
  });

  it("inspiration cards remain separate from content and survive migration", () => {
    const restored = migrateWorkspace({
      ...workspace(),
      inspirationCards: [
        {
          id: "idea-1",
          text: "从一个真实场景测试三种 AI 工具。",
          createdAt: "2026-07-20T09:00:00.000Z",
          updatedAt: "2026-07-20T09:00:00.000Z",
          convertedContentIds: ["content-1"],
        },
      ],
    });
    expect(restored?.inspirationCards.length).toBe(1);
    expect(restored?.inspirationCards[0].text).toBe("从一个真实场景测试三种 AI 工具。");
    expect(restored?.inspirationCards[0].convertedContentIds).toEqual(["content-1"]);
    expect(restored?.contents.length).toBe(1);
  });

  it("review days, live sessions, and custom schedules survive versioned backup migration", () => {
    const session: LiveSession = {
      id: "live-backup",
      title: "周末直播",
      plannedDate: "2026-07-25",
      startTime: "19:30",
      endTime: "20:30",
      platform: "小红书",
      content: "一周 AI 工具复盘",
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    };
    const restored = migrateWorkspace({
      ...workspace(),
      reviewDays: [{ id: "review-backup", plannedDate: "2026-07-24", note: "", createdAt: "2026-07-18T12:00:00.000Z" }],
      liveSessions: [session],
      scheduleObjectTypes: [{
        id: "schedule-type-backup",
        kind: "custom",
        name: "活动",
        description: "线下安排",
        color: "#4F7A72",
        archived: false,
        createdAt: "2026-07-18T12:00:00.000Z",
      }],
      scheduleObjects: [{
        id: "schedule-object-backup",
        typeId: "schedule-type-backup",
        title: "行业交流会",
        plannedDate: "2026-07-26",
        startTime: "14:00",
        endTime: "17:00",
        details: "带名片",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
      }],
    });
    expect(restored?.schemaVersion).toBe(16);
    expect(restored?.reviewDays[0].plannedDate).toBe("2026-07-24");
    expect(restored?.liveSessions[0]).toEqual(session);
    expect(restored?.scheduleObjectTypes.find((item) => item.id === "schedule-type-backup")?.name).toBe("活动");
    expect(restored?.scheduleObjects[0].title).toBe("行业交流会");
  });

  it("moving a pipeline card forward records every crossed stage", () => {
    const item = content({ stage: "script", publicationStatus: "draft", publishedAt: "" });
    const next = transitionContentStage(workspace(item), item.id, "publishing", "2026-07-18");
    expect(next.contents[0].stage).toBe("publishing");
    expect(next.stageEvents.map((event) => event.stage)).toEqual(["script", "recording", "editing"]);
    expect(next.stageEvents.every((event) => Boolean(event.completedAt))).toBe(true);
  });
});
