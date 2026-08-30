/**
 * 给静止关接线之前出的成片补量一次(二十三期)。
 *
 * 不补的话, 已有的十几条片子在界面上全是「没量过」—— 而它们的文件都还在盘上,
 * 量一次的成本只是一次 ffmpeg 扫描。补的是**对实际交付的那个文件的真实测量**,
 * 不是拿别处的数字填进去。
 *
 * 幂等: 已经有 freezeReport 的跳过(除非 --force)。
 * 用法: npx tsx scripts/backfill-freeze-report.ts [--force]
 */
import 'dotenv/config';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { runFreezeDetect, buildFreezeReport, DEFAULT_FREEZE_OPTS } from '@/lib/video/freeze-check';
import { probeVideoDurationMs } from '@/lib/video/ffmpeg';
import { promises as fs } from 'fs';

async function main() {
  const force = process.argv.includes('--force');
  const rows = await prisma.videoProduction.findMany({
    select: { id: true, previewPath: true, masterPath: true, freezeReport: true },
  });

  let done = 0, skipped = 0, missing = 0;
  for (const vp of rows) {
    if (vp.freezeReport && !force) { skipped += 1; continue; }
    // 有正式成片就量正式的 —— 用户在页面上看到的播放器也优先放它
    const kind = vp.masterPath ? 'master' : 'preview';
    const file = vp.masterPath ?? vp.previewPath;
    if (!file) { missing += 1; continue; }
    try { await fs.access(file); } catch { missing += 1; continue; }

    const totalSec = ((await probeVideoDurationMs(file)) ?? 0) / 1000;
    if (totalSec <= 0) { missing += 1; continue; }
    const segments = await runFreezeDetect(file, DEFAULT_FREEZE_OPTS, undefined, totalSec);
    const report = buildFreezeReport(segments, totalSec, kind, new Date().toISOString());
    await prisma.videoProduction.update({ where: { id: vp.id }, // FreezeReport 是具名接口, 没有索引签名, Prisma 的 InputJsonValue 收不下 —— 这里
      // 断言而不是把接口改成 Record: 界面靠这个具名类型读字段, 松开它得不偿失
      data: { freezeReport: report as unknown as Prisma.InputJsonValue } });
    console.log(
      `${vp.id}  ${kind}  静止 ${report.frozenSec.toFixed(1)}s / ${report.totalSec.toFixed(1)}s ` +
      `(${Math.round(report.ratio * 100)}%, ${report.count} 段)  ${report.ok ? '通过' : '不通过'}`,
    );
    done += 1;
  }
  console.log(`\n补量 ${done} 条, 跳过(已有) ${skipped} 条, 文件不在/量不到 ${missing} 条。`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
