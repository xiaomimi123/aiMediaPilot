/**
 * xhs 存量阶段归并脚本 (九期 Task 4, platform-stage-flows)
 *
 * 背景: 九期引入平台差异化流水线 (PLATFORM_STAGE_FLOW, 见 src/lib/cockpit/platform-stages.ts) ——
 * 小红书 (xiaohongshu) 是纯 AI 图文产线, recording/editing 两个阶段对它是永远空走的死阶段
 * (已从 xiaohongshu 的 flow 中剔除)。本脚本一次性归并特性上线前遗留下来、卡在
 * recording/editing 阶段的小红书存量卡片, 把它们的 stage 拨回 'script'。
 *
 * 用法:
 *   npx tsx scripts/migrate-xhs-stages.ts          # dry-run (默认): 只打印待归并清单, 不写库
 *   npx tsx scripts/migrate-xhs-stages.ts --apply   # 实际写库 (需先人工确认 dry-run 输出)
 *
 * 归并规则 (纯函数, 见 planXhsStageMigration, 已有单测覆盖):
 *   CockpitContent.platform === 'xiaohongshu' && stage in ['recording', 'editing'] → stage = 'script'
 *
 * 写库时单事务:
 *   逐卡 stage → 'script' + 清理该卡 CockpitStageEvent 里 stage 为 recording/editing 且
 *   completedAt === '' (未完成) 的排期记录 + 按去重后的 userId 逐个 bumpCockpitRev(userId, tx)
 *   —— 与 migrate-cockpit.ts / picked route 等既有钩子同一套"写完 cockpit 表就敲一下
 *   prefs.updatedAt"约定, 避免已打开标签页的整页保存用旧 state 覆盖掉这次归并的结果。
 *
 *   StageEvent 历史不动: completedAt 非空的行是"已完成"的历史记录 (workflow.ts 的阶段推进/
 *   撤销、picked route 的阶段前进钩子都是原地 set completedAt, 不新建行) —— 卡在 editing 的
 *   小红书卡片几乎必然带一条 completedAt 非空的 recording 历史 (录制已完成才会推进到剪辑)，
 *   只删 completedAt === '' 的未完成排期, 已完成历史必须原样保留。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { bumpCockpitRev } from "@/lib/cockpit/server-store";
import { todayISO } from "@/lib/cockpit/calculations";

const APPLY = process.argv.includes("--apply");

const DEAD_STAGES_FOR_XHS = ["recording", "editing"] as const;

export interface XhsStageRow {
  id: string;
  title: string;
  platform: string;
  stage: string;
  userId: string;
}

export interface XhsStagePlanItem {
  id: string;
  title: string;
  from: string;
  to: "script";
  userId: string;
}

/**
 * 纯函数: 不 import prisma, 只做"候选行 → 归并计划"的映射, 方便直接单测。
 * 即便调用方已经在查库时按 platform/stage 过滤过, 这里仍防御性地重新判定一遍——
 * 保证这个函数本身的语义是自洽、可独立验证的。
 */
export function planXhsStageMigration(contents: XhsStageRow[]): XhsStagePlanItem[] {
  return contents
    .filter(
      (c) =>
        c.platform === "xiaohongshu" &&
        (DEAD_STAGES_FOR_XHS as readonly string[]).includes(c.stage),
    )
    .map((c) => ({ id: c.id, title: c.title, from: c.stage, to: "script" as const, userId: c.userId }));
}

async function loadRows(): Promise<XhsStageRow[]> {
  return prisma.cockpitContent.findMany({
    where: { platform: "xiaohongshu", stage: { in: [...DEAD_STAGES_FOR_XHS] } },
    select: { id: true, title: true, platform: true, stage: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
}

function printPlan(rows: XhsStageRow[], plan: XhsStagePlanItem[]) {
  console.log(`\n=== xhs 存量阶段归并预览 (dry-run${APPLY ? " → 即将 --apply 写库" : ""}) ===\n`);

  if (rows.length === 0) {
    console.log("(未找到 platform=xiaohongshu 且 stage 为 recording/editing 的存量卡片)");
  }
  for (const row of rows) {
    console.log(`[${row.stage}] ${row.title} (id=${row.id})`);
  }

  console.log("\n=== 汇总 ===");
  console.log(`候选卡片: ${rows.length} 条`);
  console.log(`归并计划: ${plan.length} 条 (stage → script)`);
}

/**
 * 单事务: 逐卡 stage→'script' + 清理该卡 recording/editing 排期 + 按去重 userId bumpCockpitRev。
 * StageEvent 历史 (非 recording/editing 的其余排期记录) 不动。
 */
export async function applyMigration(plan: XhsStagePlanItem[]) {
  if (plan.length === 0) {
    console.log("\n没有需要归并的存量数据。");
    return;
  }

  const affectedUserIds = Array.from(new Set(plan.map((item) => item.userId)));
  const today = todayISO();

  await prisma.$transaction(async (tx) => {
    for (const item of plan) {
      await tx.cockpitContent.update({
        where: { id: item.id },
        data: { stage: item.to, updatedAt: today },
      });
      // completedAt === '' 是「未完成排期」的标记 (workflow.ts 的阶段推进/撤销、picked route
      // 的阶段前进钩子都是原地 set completedAt, 不新建行) —— 非空 completedAt 是已完成的历史
      // 记录, 硬约束「StageEvent 历史不动」要求这里只删未完成的死阶段排期, 已完成的历史必须保留。
      await tx.cockpitStageEvent.deleteMany({
        where: { contentId: item.id, stage: { in: [...DEAD_STAGES_FOR_XHS] }, completedAt: "" },
      });
    }
    for (const userId of affectedUserIds) {
      await bumpCockpitRev(userId, tx);
    }
  });

  console.log(`\n[完成] 已归并 ${plan.length} 条小红书存量卡片 (recording/editing → script)。`);
}

async function main() {
  const rows = await loadRows();
  const plan = planXhsStageMigration(rows);
  printPlan(rows, plan);

  if (!APPLY) {
    console.log("\n(dry-run 模式, 未写库。人工确认上方清单无误后加 --apply 执行。)");
    return;
  }

  await applyMigration(plan);
}

// 只有直接执行本脚本时才跑 main() — 单测需要 import 这个文件来拿 planXhsStageMigration/
// applyMigration 等纯函数/事务函数, 用 vitest 自动设置的 VITEST 环境变量避免 import 本文件
// 时把真的迁移流程 (真连 DB、真读写) 也顺带跑一遍。
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
