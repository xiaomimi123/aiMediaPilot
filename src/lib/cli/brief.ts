import type { PrismaClient } from '@prisma/client';
import { readCollectStatus, readScanStatus, type CollectStatus } from '@/lib/douyin/collect-log';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { findCandidate } from '@/lib/retro/match';
import { PROFILE_METRICS } from '@/lib/douyin/profile';
import type { Diagnosis } from '@/lib/retro/diagnose';

export interface BriefInput {
  collect: CollectStatus;
  scan: CollectStatus;
  hits: { author: string; ratio: number | null; topic: string }[];
  retros: { title: string; line: string }[];
  pendingLinks: number;
  lessonCandidates: number;
  fans: number | null;
  fansDelta: number | null;
}

const fansLine = (i: BriefInput) => (i.fans === null ? '' : `粉丝 ${i.fans}${i.fansDelta ? `（${i.fansDelta > 0 ? '+' : ''}${i.fansDelta}）` : ''}`);

/** 微信简报: 合并成一条; 什么都没有时只一句话 */
export function buildBrief(i: BriefInput): string {
  const warns = [i.collect, i.scan].filter((s) => s.state !== 'ok').map((s) => `⚠ ${s.hint}`);
  const pend = [i.pendingLinks ? `${i.pendingLinks} 条作品关联` : '', i.lessonCandidates ? `${i.lessonCandidates} 条写法经验` : ''].filter(Boolean).join('，');
  if (!warns.length && !i.hits.length && !i.retros.length && !pend) return `昨晚一切正常，没有新爆款。${fansLine(i)}`.trim();
  return [
    'MediaPilot 早报',
    ...warns,
    ...(i.hits.length ? [`对标爆款 ${i.hits.length} 条：`, ...i.hits.slice(0, 3).map((h) => `· ${h.author}（平时 ${h.ratio ?? '?'} 倍）${h.topic}`)] : []),
    ...(i.retros.length ? ['复盘：', ...i.retros.map((r) => `· ${r.title}：${r.line}`)] : []),
    ...(pend ? [`待你确认：${pend}（回电脑上看）`] : []),
    fansLine(i),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function loadBriefInput(db: PrismaClient, now: Date): Promise<BriefInput> {
  const since = new Date(now.getTime() - 86400_000);
  const hits = await db.benchmarkVideo.findMany({ where: { hitAt: { gte: since }, status: { not: 'ignored' } }, include: { account: true }, orderBy: { ratio: 'desc' } });
  const retros = await db.retro.findMany({ where: { updatedAt: { gte: since } }, include: { project: true } });
  let pendingLinks = 0;
  for (const p of await db.project.findMany({ where: { stage: 'final' }, select: { id: true } })) if (await findCandidate(db, p.id)) pendingLinks++;
  const fans = await db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.followers } });
  return {
    collect: await readCollectStatus(now),
    scan: await readScanStatus(now),
    hits: hits.map((h) => {
      const a = AnalysisSchema.safeParse(h.analysis);
      return { author: h.account.nickname, ratio: h.ratio, topic: a.success ? a.data.topic : h.desc.replace(/#\S+/g, '').trim().slice(0, 24) };
    }),
    retros: retros.map((r) => {
      const d = r.diagnosis as unknown as Diagnosis;
      const bad = d.stages?.find((s) => s.verdict === 'bad');
      return { title: r.project.title, line: bad ? `${bad.label}比平时差` : (r.narrative ?? '').split(/[。！]/)[0] || '已出复盘' };
    }),
    pendingLinks,
    lessonCandidates: await db.writingLesson.count({ where: { status: 'candidate' } }),
    fans: fans?.currentCount ?? null,
    fansDelta: fans?.lastPeriodIncr ?? null,
  };
}
