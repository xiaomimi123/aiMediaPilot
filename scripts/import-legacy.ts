import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * 把 data/legacy-export.json 里的人设与回采数据导入新库(2026-09-27 重构)。
 * 旧稿子不导入 —— 留在 JSON 里, 需要时 agent 读。幂等, 且不回退回采已写入的更新数据。
 */
type Row = Record<string, unknown>;

async function main() {
  const file = path.join(process.cwd(), 'data', 'legacy-export.json');
  const dump = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    persona: Row | null;
    publishedWorks: Row[];
    overviewSnapshots: Row[];
    metricSummaries: Row[];
  };
  const prisma = new PrismaClient();
  try {
    if (dump.persona) {
      const p = dump.persona;
      const data = {
        audience: String(p.audience ?? ''),
        targetFans: String(p.targetFans ?? ''),
        pillars: (p.pillars ?? []) as Prisma.InputJsonValue,
        angle: String(p.angle ?? ''),
        avoid: String(p.avoid ?? ''),
        painPoints: (p.painPoints ?? []) as Prisma.InputJsonValue,
        offerings: (p.offerings ?? []) as Prisma.InputJsonValue,
        systemSummary: String(p.systemSummary ?? ''),
      };
      await prisma.personaProfile.upsert({ where: { id: 'me' }, update: data, create: { id: 'me', ...data } });
    }

    for (const w of dump.publishedWorks) {
      const data = {
        title: String(w.title),
        caption: String(w.caption ?? ''),
        hashtags: (w.hashtags ?? []) as Prisma.InputJsonValue,
        url: String(w.url ?? ''),
        publishedAt: new Date(String(w.publishedAt)),
        durationSec: Number(w.durationSec ?? 0),
        isPrivate: Boolean(w.isPrivate),
        play: Number(w.play ?? 0),
        digg: Number(w.digg ?? 0),
        comment: Number(w.comment ?? 0),
        collect: Number(w.collect ?? 0),
        share: Number(w.share ?? 0),
        anaPlay: w.anaPlay == null ? null : Number(w.anaPlay),
        completionRate5s: w.completionRate5s == null ? null : Number(w.completionRate5s),
        bounceRate2s: w.bounceRate2s == null ? null : Number(w.bounceRate2s),
        avgPlayDurationSec: w.avgPlayDurationSec == null ? null : Number(w.avgPlayDurationSec),
        playPerClient: w.playPerClient == null ? Prisma.JsonNull : (w.playPerClient as Prisma.InputJsonValue),
        analyticsFetchedAt: w.analyticsFetchedAt ? new Date(String(w.analyticsFetchedAt)) : null,
        fetchedAt: new Date(String(w.fetchedAt)),
      };
      const platform = String(w.platform ?? 'douyin');
      const externalId = String(w.externalId);
      const existing = await prisma.publishedWork.findUnique({
        where: { platform_externalId: { platform, externalId } },
        select: { id: true, analyticsFetchedAt: true },
      });
      if (!existing) {
        await prisma.publishedWork.create({ data: { platform, externalId, ...data } });
      } else if (!existing.analyticsFetchedAt && data.analyticsFetchedAt) {
        // 回采可能已先写入更新的播放数等 —— 不回退它们, 只补上缺的投稿分析字段
        const { anaPlay, completionRate5s, bounceRate2s, avgPlayDurationSec, playPerClient, analyticsFetchedAt } = data;
        await prisma.publishedWork.update({
          where: { id: existing.id },
          data: { anaPlay, completionRate5s, bounceRate2s, avgPlayDurationSec, playPerClient, analyticsFetchedAt },
        });
      }
    }

    for (const s of dump.overviewSnapshots) {
      const { id: _id, userId: _u, fetchedAt, ...rest } = s;
      const data = { ...(rest as Row), fetchedAt: new Date(String(fetchedAt)) } as Prisma.DouyinOverviewSnapshotCreateInput;
      await prisma.douyinOverviewSnapshot.upsert({
        where: { windowStart_windowEnd: { windowStart: data.windowStart, windowEnd: data.windowEnd } },
        update: data,
        create: data,
      });
    }

    for (const m of dump.metricSummaries) {
      const metric = String(m.metric);
      const data = {
        currentCount: Number(m.currentCount ?? 0),
        lastPeriodIncr: Number(m.lastPeriodIncr ?? 0),
        fetchedAt: new Date(String(m.fetchedAt)),
      };
      // 已有的行来自更新的回采, 不用旧值覆盖
      await prisma.douyinMetricSummary.upsert({ where: { metric }, update: {}, create: { metric, ...data } });
    }

    const counts = await Promise.all([
      prisma.personaProfile.count(),
      prisma.publishedWork.count(),
      prisma.douyinOverviewSnapshot.count(),
      prisma.douyinMetricSummary.count(),
    ]);
    console.log(`导入完成: 人设 ${counts[0]} / 作品 ${counts[1]} / 账号快照 ${counts[2]} / 指标 ${counts[3]}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
