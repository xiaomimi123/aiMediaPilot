import { describe, it, expect } from "vitest";
import {
  mapDraftToCockpit,
  mapTopicToCockpit,
  mapInspirationToCockpit,
  backfillStageEvents,
  backfillDraftStageEvents,
  type SourceScriptDraft,
  type SourceAnalysisSummary,
  type SourceActualMetric,
  type SourceTopicIdea,
  type SourceInspirationVideo,
} from "@/lib/cockpit/migrate-mapping";
import type { ContentItem } from "@/lib/cockpit/model";

function draft(overrides: Partial<SourceScriptDraft> = {}): SourceScriptDraft {
  return {
    id: "draft-1",
    topic: "AI 剪辑工具横评",
    output: {
      titles: [{ text: "3 个 AI 剪辑工具，谁才是效率之王", hookType: "对比" }],
      hooks: [{ text: "你还在手动剪片吗？" }],
    },
    picked: null,
    createdAt: new Date("2026-07-01T08:00:00.000Z"),
    ...overrides,
  };
}

function analysis(overrides: Partial<SourceAnalysisSummary> = {}): SourceAnalysisSummary {
  return {
    id: "analysis-1",
    publishedAt: null,
    retroStatus: null,
    retroReport: null,
    createdAt: new Date("2026-07-05T09:00:00.000Z"),
    retroCompletedAt: null,
    ...overrides,
  };
}

function metric(overrides: Partial<SourceActualMetric> = {}): SourceActualMetric {
  return {
    plays: 12000n,
    likes: 800n,
    comments: 60n,
    collects: 300n,
    snapshotAt: new Date("2026-07-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("mapDraftToCockpit — deriveStage 分支映射", () => {
  it("DRAFTING (picked=null, 无 analysis) → stage=script, draft", () => {
    const { content, analysisId } = mapDraftToCockpit(draft(), null, 0, null);
    expect(content.stage).toBe("script");
    expect(content.publicationStatus).toBe("draft");
    expect(analysisId).toBeNull();
  });

  it("READY (picked≠null, 无 analysis) → stage=recording, script 摘录来自 picked+output", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const { content } = mapDraftToCockpit(d, null, 0, null);
    expect(content.stage).toBe("recording");
    expect(content.publicationStatus).toBe("draft");
    expect(content.script.headline).toBe("3 个 AI 剪辑工具，谁才是效率之王");
    expect(content.script.hook).toBe("你还在手动剪片吗？");
  });

  it("SHOT (有 analysis, 未发布/无 distribution) → stage=publishing, analysisId 落 FK", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis();
    const { content, analysisId } = mapDraftToCockpit(d, a, 0, null);
    expect(content.stage).toBe("publishing");
    expect(content.publicationStatus).toBe("draft");
    expect(analysisId).toBe("analysis-1");
  });

  it("PUBLISHED (analysis.publishedAt 非空) → stage=review, published, publishedAt+metrics 落地", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis({ publishedAt: new Date("2026-07-08T10:00:00.000Z") });
    const m = metric();
    const { content } = mapDraftToCockpit(d, a, 0, m);
    expect(content.stage).toBe("review");
    expect(content.publicationStatus).toBe("published");
    expect(content.publishedAt).toBe("2026-07-08");
    expect(content.metrics.views).toBe(12000);
    expect(content.metrics.likes).toBe(800);
    expect(content.metrics.comments).toBe(60);
    expect(content.metrics.saves).toBe(300);
    expect(content.metrics.capturedAt).toBe("2026-07-10");
  });

  it("PUBLISHED via distributionCount>0 (无 analysis.publishedAt) 同样落 review/published", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis();
    const { content } = mapDraftToCockpit(d, a, 1, null);
    expect(content.stage).toBe("review");
    expect(content.publicationStatus).toBe("published");
  });

  it("RETROED (retroStatus=COMPLETED) → stage=archived, review.analysis 来自 retroReport 摘要", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis({
      publishedAt: new Date("2026-07-08T10:00:00.000Z"),
      retroStatus: "COMPLETED",
      retroReport: { predictedOverallScore: 72, inferredActualScore: 81 },
      retroCompletedAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    const m = metric();
    const { content } = mapDraftToCockpit(d, a, 0, m);
    expect(content.stage).toBe("archived");
    expect(content.publicationStatus).toBe("published");
    expect(content.review.analysis).toBe("预测分 72 / 实际分 81");
    expect(content.review.completedAt).toBe("2026-07-12T00:00:00.000Z");
  });

  it("RETROED 但 retroReport 为空时 review.analysis 留空", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis({
      publishedAt: new Date("2026-07-08T10:00:00.000Z"),
      retroStatus: "COMPLETED",
      retroReport: null,
    });
    const { content } = mapDraftToCockpit(d, a, 0, null);
    expect(content.stage).toBe("archived");
    expect(content.review.analysis).toBe("");
  });

  it("BigInt 指标正确转换为 Number", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis({ publishedAt: new Date("2026-07-08T10:00:00.000Z") });
    const m = metric({ plays: 9_007_199_254n, likes: 123n, comments: 4n, collects: 56n });
    const { content } = mapDraftToCockpit(d, a, 0, m);
    expect(content.metrics.views).toBe(9_007_199_254);
    expect(typeof content.metrics.views).toBe("number");
  });

  it("每个映射内容都带唯一 crypto.randomUUID id", () => {
    const { content: c1 } = mapDraftToCockpit(draft(), null, 0, null);
    const { content: c2 } = mapDraftToCockpit(draft(), null, 0, null);
    expect(c1.id).not.toBe(c2.id);
    expect(c1.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("backfillStageEvents — StageEvent 补齐计数", () => {
  function content(stage: ContentItem["stage"]): ContentItem {
    return {
      id: "content-x",
      title: "t",
      idea: "",
      contentType: "",
      tier: "B",
      stage,
      publicationStatus: "draft",
      priority: "normal",
      tags: [],
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-01T08:00:00.000Z",
      publishedAt: "",
      xhsLink: "",
      coverCopy: "",
      publishCopy: "",
      topic: {
        audience: "",
        painPoint: "",
        pointOfView: "",
        commonAngle: "",
        contrastAngle: "",
        assets: "",
        minimumProduction: "",
        score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
      },
      script: { headline: "", hook: "", conclusion: "", body: "", example: "", ending: "" },
      recordingNotes: "",
      editingNotes: "",
      metrics: { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt: "" },
      review: { rating: 0, analysis: "", learnedRule: "", completedAt: "" },
    };
  }

  it("script 阶段 → 只补齐 topic (1 条)", () => {
    const events = backfillStageEvents(content("script"));
    expect(events).toHaveLength(1);
    expect(events.map((e) => e.stage)).toEqual(["topic"]);
    expect(events.every((e) => e.completedAt)).toBe(true);
  });

  it("recording 阶段 → 补齐 topic+script (2 条)", () => {
    const events = backfillStageEvents(content("recording"));
    expect(events.map((e) => e.stage)).toEqual(["topic", "script"]);
  });

  it("publishing 阶段 → 补齐 topic/script/recording/editing (4 条)", () => {
    const events = backfillStageEvents(content("publishing"));
    expect(events.map((e) => e.stage)).toEqual(["topic", "script", "recording", "editing"]);
  });

  it("review 阶段 → 全部 5 个 schedulable stage 补齐", () => {
    const events = backfillStageEvents(content("review"));
    expect(events.map((e) => e.stage)).toEqual([
      "topic",
      "script",
      "recording",
      "editing",
      "publishing",
    ]);
  });

  it("archived 阶段 → 同样全部 5 条补齐", () => {
    const events = backfillStageEvents(content("archived"));
    expect(events).toHaveLength(5);
  });

  it("每条事件 contentId 指回传入的 content", () => {
    const events = backfillStageEvents(content("recording"));
    expect(events.every((e) => e.contentId === "content-x")).toBe(true);
  });

  it("plannedDate 使用传入 stageDates 的日期部分, completedAt 是完整 ISO", () => {
    const events = backfillStageEvents(content("script"), {
      topic: new Date("2026-06-20T15:30:00.000Z"),
    });
    expect(events[0].plannedDate).toBe("2026-06-20");
    expect(events[0].completedAt).toBe("2026-06-20T15:30:00.000Z");
  });

  it("backfillDraftStageEvents 用 draft/analysis 时间戳派生各阶段日期", () => {
    const d = draft({ picked: { titleIdx: 0, hookIdx: 0, reviewed: {} } });
    const a = analysis(); // SHOT: 有 analysis, 未发布/无 distribution → stage=publishing
    const { content } = mapDraftToCockpit(d, a, 0, null);
    const events = backfillDraftStageEvents(content, d, a);
    expect(events).toHaveLength(4); // publishing 阶段: topic/script/recording/editing
    const publishingEventsAreAbsent = events.every((e) => e.stage !== "publishing");
    expect(publishingEventsAreAbsent).toBe(true);
  });
});

describe("mapTopicToCockpit — TopicIdea 池", () => {
  function topic(overrides: Partial<SourceTopicIdea> = {}): SourceTopicIdea {
    return {
      id: "topic-1",
      title: "副业变现的 5 个坑",
      note: "对标账号 XX 做过类似选题",
      status: "POOL",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("POOL → { stage: topic, title, idea: note }", () => {
    const content = mapTopicToCockpit(topic());
    expect(content).not.toBeNull();
    expect(content!.stage).toBe("topic");
    expect(content!.title).toBe("副业变现的 5 个坑");
    expect(content!.idea).toBe("对标账号 XX 做过类似选题");
    expect(content!.publicationStatus).toBe("draft");
  });

  it("note 为 null 时 idea 落空字符串", () => {
    const content = mapTopicToCockpit(topic({ note: null }));
    expect(content!.idea).toBe("");
  });

  it("ADOPTED → 跳过 (返回 null)", () => {
    expect(mapTopicToCockpit(topic({ status: "ADOPTED" }))).toBeNull();
  });

  it("DISCARDED → 跳过 (返回 null)", () => {
    expect(mapTopicToCockpit(topic({ status: "DISCARDED" }))).toBeNull();
  });
});

describe("mapInspirationToCockpit — 灵感视频", () => {
  function video(overrides: Partial<SourceInspirationVideo> = {}): SourceInspirationVideo {
    return {
      id: "video-1",
      title: "3 分钟学会 AI 抠图",
      userNote: "开头节奏很快，值得借鉴",
      fetchedAt: new Date("2026-07-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("有 userNote → 标题 + 要点拼接", () => {
    const card = mapInspirationToCockpit(video());
    expect(card.text).toBe("3 分钟学会 AI 抠图\n开头节奏很快，值得借鉴");
    expect(card.convertedContentIds).toEqual([]);
  });

  it("无 userNote → 退化为标题迁移", () => {
    const card = mapInspirationToCockpit(video({ userNote: null }));
    expect(card.text).toBe("3 分钟学会 AI 抠图");
  });

  it("userNote 为空白字符串时同样退化为标题迁移", () => {
    const card = mapInspirationToCockpit(video({ userNote: "   " }));
    expect(card.text).toBe("3 分钟学会 AI 抠图");
  });
});
