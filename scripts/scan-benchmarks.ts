import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runScan } from '../src/lib/benchmark/scan';
import { createPrismaStore } from '../src/lib/benchmark/store';
import { createDouyinClient, SCAN_SPACE } from '../src/lib/benchmark/douyin';
import { runEgo } from '../src/lib/ego';
import { analyzeVideo } from '../src/lib/benchmark/analyze';
import { createAnalyzeDeps } from '../src/lib/benchmark/deps';
import { readScanStatus, shouldSkipScheduled } from '../src/lib/douyin/collect-log';

/**
 * 每晚 20:30 巡检对标账号(排在 20:00 回采之后, 两个都用 ego lite 默认配置, 错开不抢页面)。
 * 与 collect-douyin 同样的规矩: 独立脚本直接写库; 失败写进日志并 exit 1, 首页读日志告警。
 */
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  // 定时触发(含失败补跑): 刚巡检成功过就不再访问抖音; 手动运行不带 --scheduled, 照常跑
  if (process.argv.includes('--scheduled')) {
    const now = new Date();
    const status = await readScanStatus(now);
    if (shouldSkipScheduled(status, now)) {
      const h = Math.max(1, Math.round((now.getTime() - new Date(status.lastSuccessAt!).getTime()) / 3600_000));
      log(`刚巡检成功过（${h} 小时前），这次定时补跑跳过`);
      return;
    }
  }
  const db = new PrismaClient();
  try {
    const client = createDouyinClient((s) => runEgo(s, 3 * 60_000), SCAN_SPACE);
    const analyzeDeps = await createAnalyzeDeps(db, client);
    const r = await runScan({
      store: createPrismaStore(db),
      client,
      analyze: (id) => analyzeVideo(analyzeDeps, id),
      log,
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      now: () => new Date(),
      random: Math.random,
    });
    if (r.stopped || (r.accounts > 0 && r.failed === r.accounts)) process.exit(1);
  } catch (e) {
    log(`未预期的错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void main();
