import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createGenDeps } from '../src/lib/topics/deps';
import { generateDailyTopics, NO_SOURCE_REASON } from '../src/lib/topics/generate';
import { localDay } from '../src/lib/topics/candidates';

/**
 * 每晚出 3 个选题与初稿(对标爆款 / 自己作品的续集 / 点子池)。
 * 定时触发带 --scheduled(含 0:00、1:00 的失败补跑): 今天已经生成过就跳过; 手动运行照常生成。
 */

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const now = new Date();
    const deps = await createGenDeps(db, now);
    if (process.argv.includes('--scheduled') && (await deps.doneToday(localDay(now)))) {
      log('今天已经生成过选题，这次定时补跑跳过');
      return;
    }
    log('开始生成');
    const r = await generateDailyTopics(deps);
    const why = r.skipped.map((s) => s.reason).join('；');
    // 一个都没生成: 没模型等算失败(要补跑, 「今天」提示); 没有选题来源算完成(补跑也没用, 原因在「今天」里提示)
    if (r.created === 0 && !r.skipped.every((s) => s.reason === NO_SOURCE_REASON)) {
      log(`生成失败: ${why || '没有生成任何选题'}`);
      process.exitCode = 1;
      return;
    }
    log(`生成完成: ${r.created} 个${why ? `（跳过：${why}）` : ''}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  log(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
