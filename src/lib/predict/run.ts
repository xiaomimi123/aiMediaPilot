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
import { computePrediction, type FormulaParams, type PredictionResult } from './formula';
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
}

export interface PredictDeps {
  load(projectId: string, kind: PredictKind): Promise<PredictInput>;
  llm: StructuredLLM | null;
  modelLabel: string;
  save(row: { projectId: string; kind: PredictKind; formulaVersion: number; inputHash: string; scores: DimScore[]; result: PredictionResult }): Promise<{ id: string }>;
  trimDrafts(projectId: string): Promise<void>;
}

async function scoreWithRetry(deps: PredictDeps, input: ScoreInput): Promise<DimScore[]> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return await scoreScript(deps.llm!, input);
    } catch (e) {
      last = e;
    }
  }
  const explained = explainModelError(last, deps.modelLabel);
  // 连不上 / key 错等给出模型原因; 其余(格式不对)统一说没按格式打分
  throw new PredictRefused(/出错了：/.test(explained) || last instanceof z.ZodError ? '模型没按格式打分，再点一次试试' : explained);
}

export async function runPrediction(deps: PredictDeps, projectId: string, kind: PredictKind) {
  return withProjectLock(`predict:${projectId}`, async () => {
    const input = await deps.load(projectId, kind);
    if (input.published) throw new PredictRefused(PUBLISHED_REFUSAL);
    const useTranscript = kind === 'recorded';
    if (useTranscript ? !input.transcript?.length : !input.segments?.length) throw new PredictRefused(useTranscript ? '还没有转写，不能按口播预测' : '还没有稿子，不能预测');
    if (!deps.llm) throw new PredictRefused(NO_MODEL_MESSAGE);
    const scoreInput: ScoreInput = { segments: useTranscript ? null : input.segments, transcript: useTranscript ? input.transcript : null, persona: input.persona, benchmark: input.benchmark };
    const scores = await scoreWithRetry(deps, scoreInput);
    const result = computePrediction({ scores: scoreMap(scores), baselines: input.baselines, baselineViews: input.baselineViews, benchmarkHit: input.benchmarkHit, calibratedCount: input.calibratedCount, params: input.formula.params });
    const inputHash = createHash('sha256').update(JSON.stringify(useTranscript ? input.transcript : input.segments)).digest('hex').slice(0, 12);
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
        formula: await ensureActiveFormula(db),
      };
    },
    async save(row) {
      const r = await db.prediction.create({ data: { ...row, scores: row.scores as unknown as Prisma.InputJsonValue, result: row.result as unknown as Prisma.InputJsonValue } });
      return { id: r.id };
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
