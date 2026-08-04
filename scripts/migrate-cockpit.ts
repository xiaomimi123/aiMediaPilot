/**
 * 存量数据 → Creator Cockpit 迁移脚本 (Task 9)
 *
 * 用法:
 *   npx tsx scripts/migrate-cockpit.ts          # dry-run (默认): 只打印映射结果, 不写库
 *   npx tsx scripts/migrate-cockpit.ts --apply   # 实际写库 (需先人工确认 dry-run 输出)
 *
 * 迁移源: ScriptDraft (+ ContentAnalysis + ActualMetric + Distribution)、TopicIdea、
 * InspirationVideo。旧表不删不改, 只读不写。
 *
 * 映射规则见 src/lib/cockpit/migrate-mapping.ts (纯函数, 已有单测覆盖 deriveStage 各分支)。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getOrCreateDefaultUser } from "@/lib/user";
import {
  mapDraftToCockpit,
  mapTopicToCockpit,
  mapInspirationToCockpit,
  backfillDraftStageEvents,
  type SourceScriptDraft,
  type SourceAnalysisSummary,
  type SourceActualMetric,
} from "@/lib/cockpit/migrate-mapping";
import type { ContentItem, InspirationCard, StageEvent } from "@/lib/cockpit/model";

const APPLY = process.argv.includes("--apply");

interface PlannedContent {
  content: ContentItem;
  scriptDraftId: string | null;
  analysisId: string | null;
  stageEvents: StageEvent[];
  sourceLabel: string;
  sourceId: string;
}

async function loadPlan(userId: string) {
  const [drafts, totalDraftCount, topics, videos] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId, archivedAt: null },
      include: {
        analysis: {
          include: {
            actualMetrics: { orderBy: { snapshotAt: "desc" }, take: 1 },
          },
        },
        distributions: true,
      },
    }),
    prisma.scriptDraft.count({ where: { userId } }),
    prisma.topicIdea.findMany({ where: { userId } }),
    prisma.inspirationVideo.findMany({ where: { userId } }),
  ]);

  const contents: PlannedContent[] = [];
  const skippedArchivedDrafts = totalDraftCount - drafts.length;
  let skippedNonPoolTopics = 0;

  for (const draft of drafts) {
    const sourceDraft: SourceScriptDraft = {
      id: draft.id,
      topic: draft.topic,
      output: draft.output,
      picked: draft.picked,
      createdAt: draft.createdAt,
    };
    const sourceAnalysis: SourceAnalysisSummary | null = draft.analysis
      ? {
          id: draft.analysis.id,
          publishedAt: draft.analysis.publishedAt,
          retroStatus: draft.analysis.retroStatus,
          retroReport: draft.analysis.retroReport,
          createdAt: draft.analysis.createdAt,
          retroCompletedAt: draft.analysis.retroCompletedAt,
        }
      : null;
    const latestMetric: SourceActualMetric | null = draft.analysis?.actualMetrics[0]
      ? {
          plays: draft.analysis.actualMetrics[0].plays,
          likes: draft.analysis.actualMetrics[0].likes,
          comments: draft.analysis.actualMetrics[0].comments,
          collects: draft.analysis.actualMetrics[0].collects,
          snapshotAt: draft.analysis.actualMetrics[0].snapshotAt,
        }
      : null;

    const { content, analysisId } = mapDraftToCockpit(
      sourceDraft,
      sourceAnalysis,
      draft.distributions.length,
      latestMetric,
    );
    const stageEvents = backfillDraftStageEvents(content, sourceDraft, sourceAnalysis);

    contents.push({
      content,
      scriptDraftId: draft.id,
      analysisId,
      stageEvents,
      sourceLabel: "ScriptDraft",
      sourceId: draft.id,
    });
  }

  for (const topic of topics) {
    const content = mapTopicToCockpit({
      id: topic.id,
      title: topic.title,
      note: topic.note,
      status: topic.status,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    });
    if (!content) {
      skippedNonPoolTopics += 1;
      continue;
    }
    contents.push({
      content,
      scriptDraftId: null,
      analysisId: null,
      stageEvents: [],
      sourceLabel: "TopicIdea",
      sourceId: topic.id,
    });
  }

  const inspirations: { card: InspirationCard; sourceId: string }[] = videos.map((video) => ({
    card: mapInspirationToCockpit({
      id: video.id,
      title: video.title,
      userNote: video.userNote,
      fetchedAt: video.fetchedAt,
    }),
    sourceId: video.id,
  }));

  return {
    contents,
    inspirations,
    skippedArchivedDrafts,
    skippedNonPoolTopics,
    totalDraftsSeen: drafts.length,
    totalTopicsSeen: topics.length,
  };
}

function printPlan(plan: Awaited<ReturnType<typeof loadPlan>>) {
  console.log(`\n=== 迁移预览 (dry-run${APPLY ? " → 即将 --apply 写库" : ""}) ===\n`);

  for (const item of plan.contents) {
    console.log(`[${item.content.stage}] ${item.content.title} (${item.sourceLabel} ${item.sourceId})`);
  }
  for (const { card, sourceId } of plan.inspirations) {
    const firstLine = card.text.split("\n")[0];
    console.log(`[inspiration] ${firstLine} (InspirationVideo ${sourceId})`);
  }

  const stageCounts = plan.contents.reduce<Record<string, number>>((acc, item) => {
    acc[item.content.stage] = (acc[item.content.stage] ?? 0) + 1;
    return acc;
  }, {});
  const totalStageEvents = plan.contents.reduce((sum, item) => sum + item.stageEvents.length, 0);

  console.log("\n=== 汇总 ===");
  console.log(
    `ScriptDraft 扫描: ${plan.totalDraftsSeen} 条参与映射, 跳过 archivedAt 非空: ${plan.skippedArchivedDrafts} 条`,
  );
  console.log(`TopicIdea 扫描: ${plan.totalTopicsSeen} 条, 跳过非 POOL: ${plan.skippedNonPoolTopics} 条`);
  console.log(`InspirationVideo: ${plan.inspirations.length} 条 → 全部迁移`);
  console.log(`按 stage 分布: ${JSON.stringify(stageCounts)}`);
  console.log(`ContentItem 总计: ${plan.contents.length} 条`);
  console.log(`StageEvent 补齐总计: ${totalStageEvents} 条`);
  console.log(`InspirationCard 总计: ${plan.inspirations.length} 条`);
}

export async function applyPlan(userId: string, plan: Awaited<ReturnType<typeof loadPlan>>) {
  // onboarding 顺序守卫: 迁移脚本走的是逐条 create, 完全跳过 saveWorkspaceToDb 的
  // compare-and-set — 但如果用户还没在 `/` 走完 onboarding (没有 CockpitPrefs 行,
  // 或者 setupComplete 仍是 false), 页面此刻手里握着的是"空白开始"的全量 state。
  // 一旦迁移先写完库、用户后续在页面上随手一动触发自动保存, 那次全量保存会把刚迁移
  // 进去的数据整个 delete-then-upsert 覆盖成空 — 静默丢光迁移结果。所以必须先确认
  // onboarding 已经跑完、CockpitPrefs 行已存在且 setupComplete=true, 才允许写库。
  const prefs = await prisma.cockpitPrefs.findFirst({ where: { userId } });
  if (!prefs || !prefs.setupComplete) {
    console.error(`\n[中止] userId=${userId} 尚未完成 onboarding (CockpitPrefs ${prefs ? "setupComplete=false" : "不存在"})。`);
    console.error("请先在 `/` 完成 onboarding 再执行迁移, 否则空白开始的全量保存会清空迁移数据。");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.cockpitContent.count({ where: { userId } });
  if (existing > 0) {
    console.error(
      `\n[中止] userId=${userId} 已存在 ${existing} 条 CockpitContent — 疑似已迁移过, 拒绝重复迁移。`,
    );
    console.error("如需强制重新迁移, 请先手动清空 CockpitContent 等 Cockpit* 表 (脚本本身不做删除)。");
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const item of plan.contents) {
      const c = item.content;
      await tx.cockpitContent.create({
        data: {
          id: c.id,
          userId,
          title: c.title,
          idea: c.idea,
          contentType: c.contentType,
          tier: c.tier,
          stage: c.stage,
          publicationStatus: c.publicationStatus,
          priority: c.priority,
          tags: c.tags,
          publishedAt: c.publishedAt,
          xhsLink: c.xhsLink,
          coverCopy: c.coverCopy,
          publishCopy: c.publishCopy,
          topic: c.topic as object,
          script: c.script as object,
          recordingNotes: c.recordingNotes,
          editingNotes: c.editingNotes,
          metrics: c.metrics as object,
          review: c.review as object,
          scriptDraftId: item.scriptDraftId,
          analysisId: item.analysisId,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      });
      for (const event of item.stageEvents) {
        await tx.cockpitStageEvent.create({
          data: {
            id: event.id,
            userId,
            contentId: event.contentId,
            stage: event.stage,
            plannedDate: event.plannedDate,
            rank: event.rank,
            completedAt: event.completedAt,
          },
        });
      }
    }

    for (const { card } of plan.inspirations) {
      await tx.cockpitInspiration.create({
        data: {
          id: card.id,
          userId,
          text: card.text,
          convertedContentIds: card.convertedContentIds,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        },
      });
    }
  });

  console.log(
    `\n[完成] 已写入 ${plan.contents.length} 条 CockpitContent, ${plan.inspirations.length} 条 CockpitInspiration。`,
  );
}

async function main() {
  const user = await getOrCreateDefaultUser();
  const plan = await loadPlan(user.id);
  printPlan(plan);

  if (!APPLY) {
    console.log("\n(dry-run 模式, 未写库。人工确认上方清单无误后加 --apply 执行。)");
    return;
  }

  await applyPlan(user.id, plan);
}

// 只有直接执行本脚本时才跑 main() — 单测需要 import 这个文件来拿 applyPlan/loadPlan
// 等纯函数, 用 vitest 自动设置的 VITEST 环境变量避免 import 本文件时把真的迁移流程
// (真连 DB、真读写) 也顺带跑一遍。
if (!process.env.VITEST) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
