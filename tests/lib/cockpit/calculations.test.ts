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
    intent: "",
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

});
