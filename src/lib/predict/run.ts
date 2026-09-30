import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { computeBaseline, type MetricKey } from '@/lib/retro/diagnose';
import { toMetricSet } from '@/lib/retro/generate';
import { median } from '@/lib/benchmark/rules';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { explainModelError } from '@/lib/llm/errors';
import { JobError, withProjectLock, type JobRun } from '@/lib/jobs/runner';
import { computePrediction, DIMS, type FormulaParams, type PredictionResult } from './formula';
import { calibratedCount, ensureActiveFormula } from './store';
import { scoreMap, scoreScript, type DimScore, type ScoreInput } from './score';
import { summarize, type PredictKind } from './view';

export type { PredictKind } from './view';
export class PredictRefused extends Error {}
export const PUBLISHED_REFUSAL = '已经有数据了，这时再预测不算数';
const MAX_DRAFTS = 5;

export interface PredictInput {
  published: boolean;
  segments: ScoreInput['segments'];
  transcript: string[] | null;
  persona: string;
  benchmark: string;
  benchmarkHit: boolean;
  baselines: Partial<Record<MetricKey, number>>;
  baselineViews: number | null;
  calibratedCount: number;
  formula: { version: number; params: FormulaParams };
  /** 有播放数据的公开作品数 */
  publicWorks?: number;
}

export interface PredictDeps {
  load(projectId: string, kind: PredictKind): Promise<PredictInput>;
  llm: StructuredLLM | null;
  modelLabel: string;
  save(row: { projectId: string; kind: PredictKind; formulaVersion: number; inputHash: string; scores: DimScore[]; result: PredictionResult }): Promise<{ id: string }>;
  trimDrafts(projectId: string): Promise<void>;
  /** 同一段文字之前打过的分(文字没变就复用, 结果不再随模型波动) */
  findScores?(projectId: string, inputHash: string): Promise<DimScore[] | null>;
  /** 保存前再查一次是否已关联发布(打分要十几秒, 期间可能刚关联) */
  isPublished?(projectId: string): Promise<boolean>;
}

const isFormatError = (e: unknown) => e instanceof z.ZodError || /json|schema|format|parse|格式|expected/i.test(e instanceof Error ? e.message : String(e));

/** 同一篇打 3 次取每项中位数(模型打分有波动); 成功不到 2 次再来一轮; 仍不够才失败 */
async function scoreStable(deps: PredictDeps, input: ScoreInput): Promise<DimScore[]> {
  const ok: DimScore[][] = [];
  let last: unknown;
  for (let round = 0; round < 2 && ok.length < 2; round++) {
    const rs = await Promise.allSettled([0, 1, 2].map(() => scoreScript(deps.llm!, input)));
    for (const r of rs) {
      if (r.status === 'fulfilled') ok.push(r.value);
      else last = r.reason;
    }
  }
  if (ok.length < 2) throw new PredictRefused(isFormatError(last) ? '模型没按格式打分，再点一次试试' : explainModelError(last, deps.modelLabel));
  return DIMS.map((dim) => {
    const xs = ok.map((run) => run.find((s) => s.dim === dim)!).sort((a, b) => a.score - b.score);
    return xs[Math.floor((xs.length - 1) / 2)];
  });
}

export async function runPrediction(deps: PredictDeps, projectId: string, kind: PredictKind) {
  return withProjectLock(`predict:${projectId}`, async () => {
    const input = await deps.load(projectId, kind);
    if (input.published) throw new PredictRefused(PUBLISHED_REFUSAL);
    const useTranscript = kind === 'recorded';
    if (useTranscript ? !input.transcript?.length : !input.segments?.length) throw new PredictRefused(useTranscript ? '还没有转写，不能按口播预测' : '还没有稿子，不能预测');
    const inputHash = createHash('sha256').update(JSON.stringify(useTranscript ? input.transcript : input.segments)).digest('hex').slice(0, 12);
    const scoreInput: ScoreInput = { segments: useTranscript ? null : input.segments, transcript: useTranscript ? input.transcript : null, persona: input.persona, benchmark: input.benchmark };
    let scores = (await deps.findScores?.(projectId, inputHash)) ?? null;
    if (!scores) {
      if (!deps.llm) throw new PredictRefused(NO_MODEL_MESSAGE);
      scores = await scoreStable(deps, scoreInput);
    }
    const result = computePrediction({ scores: scoreMap(scores), baselines: input.baselines, baselineViews: input.baselineViews, benchmarkHit: input.benchmarkHit, calibratedCount: input.calibratedCount, params: input.formula.params, publicWorks: input.publicWorks });
    if (await deps.isPublished?.(projectId)) throw new PredictRefused(PUBLISHED_REFUSAL);
    const { id } = await deps.save({ projectId, kind, formulaVersion: input.formula.version, inputHash, scores, result });
    if (kind === 'draft') await deps.trimDrafts(projectId);
    return { id, summary: summarize(kind, scores, result), scores, result, formulaVersion: input.formula.version };
  });
}

export async function createPredictDeps(db: PrismaClient, llm?: StructuredLLM | null, label?: string): Promise<PredictDeps> {
  const active = llm === undefined ? await getActiveModel(db) : null;
  return {
    llm: llm === undefined ? active?.llm ?? null : llm,
    modelLabel: label ?? active?.label ?? '模型',
    async load(projectId) {
      const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: true } });
      const published = (await db.publishedWork.count({ where: { projectId } })) > 0;
      const script = ScriptSchema.safeParse(p.script);
      const report = script.success ? checkDuration(script.data, p.targetSec) : null;
      const t = await loadCurrentTranscript(db, projectId);
      const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
      const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
      const history = await db.publishedWork.findMany({ where: { isPrivate: false, viewCount: { gt: 0 } }, orderBy: { publishedAt: 'desc' }, take: 10 });
      const views = history.map((w) => w.viewCount).filter((v): v is number => v !== null && v > 0);
      return {
        published,
        segments: script.success ? script.data.segments.map((s, i) => ({ id: s.id, label: ROLE_LABEL[s.role], text: s.text, estSec: report!.segments[i].estSec })) : null,
        transcript: t ? t.data.lines.map((l) => l.text) : null,
        persona: formatPersona(persona as PersonaLike | null),
        benchmark: a?.success ? `选题：${a.data.topic}；钩子（${a.data.hook.type}）：${a.data.hook.quote}；标题写法：${a.data.titlePattern}` : '',
        benchmarkHit: (p.benchmarkVideo?.ratio ?? 0) >= 3,
        baselines: computeBaseline(history.map(toMetricSet)).medians,
        baselineViews: views.length >= 3 ? Math.round(median(views)) : null,
        calibratedCount: await calibratedCount(db),
        publicWorks: views.length,
        formula: await ensureActiveFormula(db),
      };
    },
    async save(row) {
      const r = await db.prediction.create({ data: { ...row, scores: row.scores as unknown as Prisma.InputJsonValue, result: row.result as unknown as Prisma.InputJsonValue } });
      return { id: r.id };
    },
    isPublished: async (projectId) => (await db.publishedWork.count({ where: { projectId } })) > 0,
    async findScores(projectId, inputHash) {
      const prev = await db.prediction.findFirst({ where: { projectId, inputHash }, orderBy: { createdAt: 'desc' } });
      return prev ? (prev.scores as unknown as DimScore[]) : null;
    },
    async trimDrafts(projectId) {
      const old = await db.prediction.findMany({ where: { projectId, kind: 'draft' }, orderBy: { createdAt: 'desc' }, skip: MAX_DRAFTS, select: { id: true } });
      if (old.length) await db.prediction.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    },
  };
}

export function predictJob(kind: PredictKind): JobRun {
  return async (ctx) => {
    try {
      const r = await runPrediction(await createPredictDeps(ctx.db), ctx.projectId, kind);
      return { notice: r.summary };
    } catch (e) {
      throw new JobError(e instanceof PredictRefused ? `预测没完成：${e.message}` : '预测没完成：出了意外错误，再点一次试试。', e);
    }
  };
}
