import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { StructuredLLM } from '@/lib/script/write';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { assignSegments, diagnose, type Diagnosis, type MetricSet } from './diagnose';

export const LESSON_STAGES = ['topic', 'hook', 'opening', 'middle', 'ending', 'interaction', 'title'] as const;

export const NarrativeSchema = z.object({
  summary: z.string().min(1),
  lessons: z.array(z.object({ text: z.string().min(1), stage: z.string(), evidenceMetric: z.string() })).max(10),
  contradicts: z.array(z.string()).default([]),
});

export interface RetroInput {
  projectId: string;
  workId: string;
  publishedAt: Date;
  work: MetricSet;
  metricsUpdatedAt: Date | null;
  history: MetricSet[];
  lines: { startSec: number; endSec: number; text: string; segment: string | null }[] | null;
  benchmark: { digg: number; baselineDigg: number | null } | null;
  curve: Diagnosis['curve'];
  scriptText: string;
  transcriptText: string;
  benchmarkAnalysis: string;
  activeLessons: { id: string; text: string }[];
}

export interface RetroDeps {
  load(projectId: string): Promise<RetroInput | null>;
  llm: StructuredLLM | null;
  save(r: {
    projectId: string;
    workId: string;
    dayN: number;
    diagnosis: Diagnosis;
    narrative: string | null;
    narrativeError: string | null;
    dataAsOf: Date | null;
    lessons: { text: string; stage: string; evidence: unknown[] }[];
    contradictedIds: string[];
  }): Promise<void>;
  now(): Date;
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，读一份复盘诊断，给博主解读并提炼写法经验。
- summary：3～5 句，说这条为什么火或不火。只能引用诊断里给出的数字；没把握的原因写"数据看不出原因"，不编。
- lessons：0～3 条写法经验，每条是一句能直接照做的规矩（如"开头第一句直接说结果"），stage 取 topic/hook/opening/middle/ending/interaction/title 之一，evidenceMetric 写它依据的指标名（bounceRate2s/completionRate5s/avgViewSec/completionRate/likeRate/favoriteRate/shareRate/subscribeRate）。
- contradicts：已生效经验里，这次数据明显没应验的经验 id（没有就给空数组）。
只输出 JSON。`;

const METRIC_VALUE: Record<string, (d: Diagnosis) => { value: number | null; baseline: number | null }> = {};
for (const [metric, key] of [
  ['bounceRate2s', 'hook2s'],
  ['completionRate5s', 'hook5s'],
  ['avgViewSec', 'middle'],
  ['completionRate', 'ending'],
  ['likeRate', 'like'],
  ['favoriteRate', 'favorite'],
  ['shareRate', 'share'],
  ['subscribeRate', 'subscribe'],
] as const) {
  METRIC_VALUE[metric] = (d) => {
    const s = d.stages.find((x) => x.key === key);
    return { value: s?.value ?? null, baseline: s?.baseline ?? null };
  };
}

export async function generateRetro(deps: RetroDeps, projectId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const input = await deps.load(projectId);
  if (!input) return { ok: false, reason: '这个项目还没关联发布的作品。' };
  // 播放先出、留存比率后出(离线计算); 核心比率全没有时复盘只剩一排"数据还没出来", 不如等
  const w = input.work;
  if (!w.viewCount || (w.bounceRate2s === null && w.completionRate5s === null && w.avgViewSec === null)) {
    return { ok: false, reason: '数据还没出来，明晚回采后再复盘。' };
  }
  const now = deps.now();
  const dayN = Math.max(1, Math.floor((now.getTime() - input.publishedAt.getTime()) / 86400_000));
  const diagnosis = diagnose({ work: input.work, history: input.history, lines: input.lines, benchmark: input.benchmark, curve: input.curve });

  let narrative: string | null = null;
  let narrativeError: string | null = null;
  let lessons: { text: string; stage: string; evidence: unknown[] }[] = [];
  let contradictedIds: string[] = [];
  if (!deps.llm) narrativeError = '没有配置 DeepSeek key，编导解读需要它：去设置页填入后点重试。';
  else {
    try {
      const { result } = await deps.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [
          {
            type: 'text',
            text: [
              `【诊断】\n${diagnosis.stages.map((s) => `${s.label}：${s.note}（${s.verdict}）`).join('\n')}`,
              diagnosis.benchmark ? `【对标】对标点赞是他平时的 ${diagnosis.benchmark.theirRatio} 倍；这条是你平时的 ${diagnosis.benchmark.myRatio ?? '?'} 倍` : '',
              `【定稿】\n${input.scriptText}`,
              input.transcriptText ? `【实际口播】\n${input.transcriptText}` : '',
              input.benchmarkAnalysis ? `【对标拆解】\n${input.benchmarkAnalysis}` : '',
              input.activeLessons.length ? `【已生效的写法经验】\n${input.activeLessons.map((l) => `[${l.id}] ${l.text}`).join('\n')}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        responseSchema: NarrativeSchema,
      });
      narrative = result.summary;
      lessons = result.lessons
        .filter((l) => (LESSON_STAGES as readonly string[]).includes(l.stage))
        .slice(0, 3)
        .map((l) => {
          const ev = METRIC_VALUE[l.evidenceMetric]?.(diagnosis) ?? { value: null, baseline: null };
          return { text: l.text, stage: l.stage, evidence: [{ projectId: input.projectId, workId: input.workId, metric: l.evidenceMetric, ...ev }] };
        });
      const active = new Set(input.activeLessons.map((l) => l.id));
      contradictedIds = result.contradicts.filter((id) => active.has(id));
    } catch {
      narrativeError = '编导解读没写出来，点重试。';
    }
  }
  await deps.save({ projectId, workId: input.workId, dayN, diagnosis, narrative, narrativeError, dataAsOf: input.metricsUpdatedAt, lessons, contradictedIds });
  return { ok: true };
}

export function dueRetros(rows: { projectId: string; publishedAt: Date; retroDayN: number | null }[], now: Date): string[] {
  return rows
    .filter((r) => {
      const days = (now.getTime() - r.publishedAt.getTime()) / 86400_000;
      // 第 3 天前手动复盘过(数据少)的, 到第 3 天仍自动再出一份
      if (r.retroDayN === null || r.retroDayN < 3) return days >= 3;
      return days >= 7 && r.retroDayN < 7;
    })
    .map((r) => r.projectId);
}

const toMetricSet = (w: {
  viewCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  shareCount: number | null;
  subscribeCount: number | null;
  completionRate: number | null;
  completionRate5sWl: number | null;
  completionRate5s: number | null;
  bounceRate2sWl: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
}): MetricSet => ({
  viewCount: w.viewCount,
  likeCount: w.likeCount,
  favoriteCount: w.favoriteCount,
  shareCount: w.shareCount,
  subscribeCount: w.subscribeCount,
  completionRate: w.completionRate,
  completionRate5s: w.completionRate5sWl ?? w.completionRate5s,
  bounceRate2s: w.bounceRate2sWl ?? w.bounceRate2s,
  avgViewSec: w.avgViewSec,
});

export function createRetroDeps(db: PrismaClient): RetroDeps {
  const key = getDeepSeekKey();
  return {
    llm: key ? new DeepSeekTextLLM({ apiKey: key }) : null,
    now: () => new Date(),
    async load(projectId) {
      const work = await db.publishedWork.findFirst({ where: { projectId }, orderBy: { publishedAt: 'desc' } });
      if (!work) return null;
      const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: { include: { account: true } } } });
      const history = await db.publishedWork.findMany({
        where: { isPrivate: false, id: { not: work.id }, viewCount: { gt: 0 } },
        orderBy: { publishedAt: 'desc' },
        take: 10,
      });
      const snaps = await db.workMetricSnapshot.findMany({ where: { workId: work.id }, orderBy: { day: 'asc' }, take: 7 });
      const script = ScriptSchema.safeParse(p.script);
      const t = await loadCurrentTranscript(db, projectId);
      let lines: RetroInput['lines'] = null;
      if (t) {
        const segs = script.success ? script.data.segments.map((s) => ({ label: ROLE_LABEL[s.role], text: s.text })) : [];
        lines = assignSegments(segs, t.data.lines.map((l) => ({ startSec: l.startSec, endSec: l.endSec, text: l.text })));
      }
      const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
      const active = await db.writingLesson.findMany({ where: { status: 'active' }, orderBy: { confirmedAt: 'desc' }, take: 10 });
      return {
        projectId,
        workId: work.id,
        publishedAt: work.publishedAt,
        work: toMetricSet(work),
        metricsUpdatedAt: work.metricsUpdatedAt,
        history: history.map(toMetricSet),
        lines,
        benchmark: p.benchmarkVideo ? { digg: p.benchmarkVideo.digg, baselineDigg: p.benchmarkVideo.account.baselineDigg } : null,
        curve: snaps.map((s) => ({ day: s.day, viewCount: s.viewCount, likeCount: s.likeCount })),
        scriptText: script.success ? script.data.segments.map((s) => `${ROLE_LABEL[s.role]}：${s.text}`).join('\n') : '',
        transcriptText: t ? t.data.lines.map((l) => l.text).join('\n') : '',
        benchmarkAnalysis: a?.success ? `选题：${a.data.topic}；钩子（${a.data.hook.type}）：${a.data.hook.quote}` : '',
        activeLessons: active.map((l) => ({ id: l.id, text: l.text })),
      };
    },
    async save(r) {
      const data = {
        workId: r.workId,
        dayN: r.dayN,
        diagnosis: r.diagnosis as unknown as Prisma.InputJsonValue,
        narrative: r.narrative,
        narrativeError: r.narrativeError,
        dataAsOf: r.dataAsOf,
      };
      const retro = await db.retro.upsert({ where: { projectId: r.projectId }, update: data, create: { projectId: r.projectId, ...data } });
      // 本次复盘的旧候选(未处理的)换成新的
      await db.writingLesson.deleteMany({ where: { retroId: retro.id, status: 'candidate' } });
      for (const l of r.lessons) {
        await db.writingLesson.create({ data: { text: l.text, stage: l.stage, evidence: l.evidence as Prisma.InputJsonValue, retroId: retro.id } });
      }
      if (r.contradictedIds.length) await db.writingLesson.updateMany({ where: { id: { in: r.contradictedIds } }, data: { contradicted: true } });
    },
  };
}

export async function runDueRetros(db: PrismaClient): Promise<string> {
  const works = await db.publishedWork.findMany({ where: { projectId: { not: null }, isPrivate: false }, include: { project: { include: { retro: true } } } });
  const due = dueRetros(
    works.filter((w) => w.project).map((w) => ({ projectId: w.projectId!, publishedAt: w.publishedAt, retroDayN: w.project!.retro?.dayN ?? null })),
    new Date(),
  );
  const deps = createRetroDeps(db);
  let done = 0;
  const waiting: string[] = [];
  for (const id of due) {
    const r = await generateRetro(deps, id);
    if (r.ok) done++;
    else waiting.push(r.reason);
  }
  return `复盘: 到期 ${due.length} 个, 生成 ${done} 个${waiting.length ? `, 等数据 ${waiting.length} 个` : ''}`;
}
