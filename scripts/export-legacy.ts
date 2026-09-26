import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * 重构前的一次性导出(2026-09-27)。新库不迁移旧数据, 但稿子/人设/回采快照
 * 导成 JSON 留在 data/ 下, 需要时 agent 可以读, Task 3 从这里导入人设与回采数据。
 * 本脚本只在旧 schema 下能跑, 重构后随旧代码一起只留在 tag v1-final 里。
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const persona = await prisma.personaProfile.findFirst();
    const scriptDrafts = await prisma.scriptDraft.findMany({ orderBy: { createdAt: 'asc' } });
    const publishedWorks = await prisma.publishedWork.findMany({ orderBy: { publishedAt: 'asc' } });
    const overviewSnapshots = await prisma.douyinOverviewSnapshot.findMany({ orderBy: { fetchedAt: 'asc' } });
    const metricSummaries = await prisma.douyinMetricSummary.findMany();
    const out = { exportedAt: new Date().toISOString(), persona, scriptDrafts, publishedWorks, overviewSnapshots, metricSummaries };
    const file = path.join(process.cwd(), 'data', 'legacy-export.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`导出完成: 人设 ${persona ? 1 : 0} / 稿子 ${scriptDrafts.length} / 作品 ${publishedWorks.length} / 账号快照 ${overviewSnapshots.length} / 指标 ${metricSummaries.length} → ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
