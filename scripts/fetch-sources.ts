import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { fetchAndStore } from '../src/lib/sources/fetch';

/**
 * 每天抓信息源(GitHub 爆发仓库 + HN 热帖)入库存档, 全收不过滤。
 * 与 collect-douyin 同样的规矩: 独立脚本直接写库; 失败写日志并 exit 1, 首页读日志告警。
 * 定时触发带 --scheduled: 今天已经成功抓过就跳过; 手动运行照常跑。
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
    log('开始抓取');
    if (process.argv.includes('--scheduled')) {
      const today = localDay(now);
      const last = await db.sourceItem.findFirst({ where: { day: today }, orderBy: { createdAt: 'desc' } });
      if (last) {
        log('今天已经抓过信息源，这次定时运行跳过');
        return;
      }
    }
    const r = await fetchAndStore(db, now);
    for (const e of r.errors) log(`源失败: ${e}`);
    if (!r.total) {
      log('抓取失败: 所有源都没拿到数据');
      process.exitCode = 1;
      return;
    }
    log(`抓取完成: 新存 ${r.saved} 条 / 共 ${r.total} 条${r.errors.length ? `（部分失败: ${r.errors.join('；')}）` : ''}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  log(`抓取失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
