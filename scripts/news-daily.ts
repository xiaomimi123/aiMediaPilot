import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { pickNewsRepo, produceNewsFor } from '../src/lib/sources/news-pipeline';
import { getActiveModel, NO_MODEL_MESSAGE } from '../src/lib/llm/provider';

/**
 * 每晚自动出一条开源快讯(快讯档自动出稿, roadmap 最后一项):
 * 19:00 抓完信息源后, 挑近 3 天最热的 fresh GitHub 仓库, 读 README 写 30 秒稿
 * 建作品 + AI 配音, SourceItem 标 used(不与每晚 23:00 的资讯选题重复吃同一条)。
 * 定时触发带 --scheduled: 今天已经出过就跳过; 手动运行照常跑。
 *
 * 没模型 / 没候选 / README 挂了: 记日志 exit 1(首页读日志告警), 不建半截作品。
 */

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const p = (n: number) => String(n).padStart(2, '0');
const localDay = (now: Date) => `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const now = new Date();
    log('开始自动出稿');
    if (process.argv.includes('--scheduled')) {
      const today = localDay(now);
      // 今天的快讯作品 = targetSec=30 且今天建的(每日选题是 75 秒, 不会混)
      const todayProjects = await db.project.findMany({ where: { createdAt: { gte: new Date(`${today}T00:00:00`) } }, select: { targetSec: true } });
      if (todayProjects.some((x) => x.targetSec === 30)) {
        log('今天已经出过快讯，这次定时运行跳过');
        return;
      }
    }
    const model = await getActiveModel(db);
    if (!model) throw new Error(`没模型：${NO_MODEL_MESSAGE}`);
    const pick = await pickNewsRepo(db, now);
    if (!pick) {
      log('近 3 天没有 fresh 的 GitHub 候选，跳过（先跑 npm run fetch:sources）');
      return;
    }
    log(`选中 ${pick.outerId}（${pick.heat.toLocaleString('en-US')} stars）`);
    const r = await produceNewsFor(db, { pick, llm: model.llm, voice: true });
    await db.sourceItem.update({ where: { id: pick.id }, data: { status: 'used' } });
    const v = r.voice;
    const voiceMsg = v && 'error' in v ? `（配音失败：${v.error}）` : v ? `（配音 ${(v.bytes / 1024).toFixed(0)}KB）` : '';
    log(`出稿完成: ${r.title} → 项目 ${r.project.id} ${voiceMsg}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  log(`出稿失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
