/**
 * 存量数据 → Creator Cockpit 迁移映射 (Task 9, spec: docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md)
 *
 * 纯函数, 不 import prisma — 方便直接单测。脚本壳 (scripts/migrate-cockpit.ts) 负责查库、
 * 调用这里的映射函数、再落库。
 *
 * 阶段判定完全复用 `deriveStage` (src/lib/pipeline/stage.ts) 的读时派生规则, 这里只做
 * "派生结果 → cockpit ContentItem 字段" 的转换, 不重新实现任何判定逻辑。
 *
 * 日期格式约定 (与既有 cockpit 代码库保持一致, 见 src/lib/cockpit/calculations.ts):
 *  - ContentItem.publishedAt / MetricsSnapshot.capturedAt / StageEvent.plannedDate → 日期部分 "YYYY-MM-DD"
 *    (会被 parseDate/isoDate 按纯日期比较, 见 calculations.ts:t3Date/isQualityQualified)
 *  - StageEvent.completedAt / Review.completedAt → 完整 ISO 时间戳 (或空字符串代表未完成)
 *  - ContentItem.createdAt/updatedAt、InspirationCard.createdAt/updatedAt → 完整 ISO 时间戳
 *    (未被任何比较函数按纯日期解析, 沿用来源记录的精确时间)
 */
import { randomUUID } from "crypto";
import { deriveStage, type PipelineStage } from "@/lib/pipeline/stage";
import { readScriptDraftOutput, readRetroReport } from "@/lib/json-readers";
import {
  SCHEDULABLE_STAGES,
  type ContentItem,
  type ContentStage,
  type InspirationCard,
  type StageEvent,
  type WorkStage,
} from "@/lib/cockpit/model";

// ==================== 源数据最小形状 (不依赖 @prisma/client 运行时) ====================

export interface SourceScriptDraft {
  id: string;
  topic: string;
  output: unknown;
  picked: unknown;
  createdAt: Date;
}

export interface SourceAnalysisSummary {
  id: string;
  publishedAt: Date | null;
  retroStatus: string | null;
  retroReport: unknown;
  createdAt: Date;
  retroCompletedAt: Date | null;
}

export interface SourceActualMetric {
  plays: bigint;
  likes: bigint;
  comments: bigint;
  collects: bigint;
  snapshotAt: Date;
}

export interface SourceTopicIdea {
  id: string;
  title: string;
  note: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceInspirationVideo {
  id: string;
  title: string;
  userNote: string | null;
  fetchedAt: Date;
}

export interface MappedDraft {
  content: ContentItem;
  scriptDraftId: string;
  analysisId: string | null;
}

// ==================== 日期辅助 ====================

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fullIso(date: Date): string {
  return date.toISOString();
}

// ==================== 空白骨架 (对齐 Cockpit.tsx 的 blankTopic()/blankScript()/createContent()) ====================

function blankTopicCard(): ContentItem["topic"] {
  return {
    audience: "",
    painPoint: "",
    pointOfView: "",
    commonAngle: "",
    contrastAngle: "",
    assets: "",
    minimumProduction: "",
    score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
  };
}

function blankScriptDraft(): ContentItem["script"] {
  return { headline: "", hook: "", conclusion: "", body: "", example: "", ending: "" };
}

function blankMetrics(capturedAt = ""): ContentItem["metrics"] {
  return { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt };
}

function blankReview(overrides: Partial<ContentItem["review"]> = {}): ContentItem["review"] {
  return { rating: 0, analysis: "", learnedRule: "", completedAt: "", ...overrides };
}

// ==================== deriveStage 结果 → cockpit stage / publicationStatus ====================

const STAGE_MAP: Record<PipelineStage, { stage: ContentStage; publicationStatus: ContentItem["publicationStatus"] }> = {
  DRAFTING: { stage: "script", publicationStatus: "draft" },
  READY: { stage: "recording", publicationStatus: "draft" },
  SHOT: { stage: "publishing", publicationStatus: "draft" },
  PUBLISHED: { stage: "review", publicationStatus: "published" },
  RETROED: { stage: "archived", publicationStatus: "published" },
};

// ==================== script Json 摘录 (READY 及之后, picked + output) ====================

function extractScriptExcerpt(picked: unknown, output: unknown): ContentItem["script"] {
  const parsed = readScriptDraftOutput(output);
  const p = (picked ?? {}) as { titleIdx?: number; hookIdx?: number };
  const headline =
    typeof p.titleIdx === "number" ? (parsed?.titles?.[p.titleIdx]?.text ?? "") : "";
  const hook = typeof p.hookIdx === "number" ? (parsed?.hooks?.[p.hookIdx]?.text ?? "") : "";
  return { ...blankScriptDraft(), headline, hook };
}

// ==================== retroReport 摘要 (RETROED) ====================

function retroSummary(retroReport: unknown): string {
  const parsed = readRetroReport(retroReport);
  if (!parsed) return "";
  const { predictedOverallScore, inferredActualScore } = parsed;
  if (predictedOverallScore == null && inferredActualScore == null) return "";
  const parts: string[] = [];
  if (predictedOverallScore != null) parts.push(`预测分 ${predictedOverallScore}`);
  if (inferredActualScore != null) parts.push(`实际分 ${inferredActualScore}`);
  return parts.join(" / ");
}

// ==================== StageEvent 补齐 (mirrors transitionContentStage 快进语义) ====================

const CONTENT_STAGE_ORDER: ContentStage[] = [
  "inbox",
  "topic",
  "script",
  "recording",
  "editing",
  "publishing",
  "review",
  "archived",
];

function stageOrderIndex(stage: ContentStage): number {
  return CONTENT_STAGE_ORDER.indexOf(stage);
}

/**
 * 对已经"跨过"的 SCHEDULABLE_STAGES (即 index 严格小于 content.stage 的那些), 各补一条
 * completedAt 非空的 StageEvent — 复现 transitionContentStage 从 inbox 快进到当前阶段的效果。
 *
 * stageDates: 每个 schedulable stage 对应的源记录时间 (缺省 fallback 到 content.createdAt)。
 */
export function backfillStageEvents(
  content: ContentItem,
  stageDates: Partial<Record<WorkStage, Date>> = {},
): StageEvent[] {
  const targetIndex = stageOrderIndex(content.stage);
  const fallback = new Date(content.createdAt);
  return SCHEDULABLE_STAGES.filter((stage) => stageOrderIndex(stage) < targetIndex).map((stage) => {
    const at = stageDates[stage] ?? fallback;
    return {
      id: randomUUID(),
      contentId: content.id,
      stage,
      plannedDate: isoDateOnly(at),
      rank: 0,
      completedAt: fullIso(at),
    };
  });
}

// ==================== mapDraftToCockpit ====================

export function mapDraftToCockpit(
  draft: SourceScriptDraft,
  analysis: SourceAnalysisSummary | null,
  distributionCount: number,
  latestMetric: SourceActualMetric | null,
): MappedDraft {
  const pipelineStage = deriveStage({
    picked: draft.picked,
    analysis: analysis
      ? { publishedAt: analysis.publishedAt, retroStatus: analysis.retroStatus }
      : null,
    distributionCount,
  });
  const { stage, publicationStatus } = STAGE_MAP[pipelineStage];

  const parsedOutput = readScriptDraftOutput(draft.output);
  const p = (draft.picked ?? {}) as { titleIdx?: number };
  const pickedTitle =
    typeof p.titleIdx === "number" ? parsedOutput?.titles?.[p.titleIdx]?.text : undefined;

  const script =
    pipelineStage === "DRAFTING" ? blankScriptDraft() : extractScriptExcerpt(draft.picked, draft.output);

  const publishedAt =
    (pipelineStage === "PUBLISHED" || pipelineStage === "RETROED") && analysis?.publishedAt
      ? isoDateOnly(analysis.publishedAt)
      : "";

  const metrics =
    (pipelineStage === "PUBLISHED" || pipelineStage === "RETROED") && latestMetric
      ? {
          views: Number(latestMetric.plays),
          likes: Number(latestMetric.likes),
          saves: Number(latestMetric.collects),
          comments: Number(latestMetric.comments),
          followerGain: 0,
          capturedAt: isoDateOnly(latestMetric.snapshotAt),
        }
      : blankMetrics();

  const review =
    pipelineStage === "RETROED"
      ? blankReview({
          analysis: retroSummary(analysis?.retroReport),
          completedAt: analysis?.retroCompletedAt ? fullIso(analysis.retroCompletedAt) : "",
        })
      : blankReview();

  const content: ContentItem = {
    id: randomUUID(),
    title: pickedTitle ?? draft.topic,
    idea: draft.topic,
    contentType: "",
    tier: "B",
    stage,
    publicationStatus,
    priority: "normal",
    tags: [],
    createdAt: fullIso(draft.createdAt),
    updatedAt: fullIso(analysis?.createdAt ?? draft.createdAt),
    publishedAt,
    xhsLink: "",
    coverCopy: "",
    publishCopy: "",
    topic: blankTopicCard(),
    script,
    recordingNotes: "",
    editingNotes: "",
    metrics,
    review,
  };

  return {
    content,
    scriptDraftId: draft.id,
    analysisId: pipelineStage === "DRAFTING" || pipelineStage === "READY" ? null : (analysis?.id ?? null),
  };
}

/** mapDraftToCockpit 的 StageEvent 补齐 — 各 schedulable stage 用最贴近的源时间戳。 */
export function backfillDraftStageEvents(
  content: ContentItem,
  draft: SourceScriptDraft,
  analysis: SourceAnalysisSummary | null,
): StageEvent[] {
  const shotAt = analysis?.createdAt ?? draft.createdAt;
  const publishAt = analysis?.publishedAt ?? analysis?.createdAt ?? draft.createdAt;
  return backfillStageEvents(content, {
    topic: draft.createdAt,
    script: draft.createdAt,
    recording: shotAt,
    editing: shotAt,
    publishing: publishAt,
  });
}

// ==================== mapTopicToCockpit ====================

export function mapTopicToCockpit(topic: SourceTopicIdea): ContentItem | null {
  if (topic.status !== "POOL") return null;
  return {
    id: randomUUID(),
    title: topic.title,
    idea: topic.note ?? "",
    contentType: "",
    tier: "B",
    stage: "topic",
    publicationStatus: "draft",
    priority: "normal",
    tags: [],
    createdAt: fullIso(topic.createdAt),
    updatedAt: fullIso(topic.updatedAt),
    publishedAt: "",
    xhsLink: "",
    coverCopy: "",
    publishCopy: "",
    topic: blankTopicCard(),
    script: blankScriptDraft(),
    recordingNotes: "",
    editingNotes: "",
    metrics: blankMetrics(),
    review: blankReview(),
  };
}

// ==================== mapInspirationToCockpit ====================

/**
 * InspirationVideo → CockpitInspiration.text (标题 + userNote 拼接)。
 *
 * 注: InspirationInsight 是"一批视频 → 一份聚合总结" (靠 videoIds Json 数组关联, 非 Prisma
 * relation), 不存在逐条视频的 insight 文本字段, 无法 1:1 归属到单条 InspirationVideo。
 * 因此这里用 InspirationVideo 自身真实存在的 userNote (用户对该条视频的备注) 作为"要点",
 * 没有 userNote 时退化为纯标题迁移。
 */
export function mapInspirationToCockpit(video: SourceInspirationVideo): InspirationCard {
  const note = video.userNote?.trim();
  return {
    id: randomUUID(),
    text: note ? `${video.title}\n${note}` : video.title,
    createdAt: fullIso(video.fetchedAt),
    updatedAt: fullIso(video.fetchedAt),
    convertedContentIds: [],
  };
}
