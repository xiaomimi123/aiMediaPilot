import type { PrismaClient } from '@prisma/client';
import { createPredictDeps, PredictRefused, runPrediction } from '@/lib/predict/run';
import { formatPrediction, KIND_LABEL, toPredictionView, type PredictKind } from '@/lib/predict/view';
import type { PredictionResult } from '@/lib/predict/formula';
import { CliError, needArg, type Command } from '../registry';

export function formatPredictList(rows: { id: string; title: string; kind: string; center: number | null; top: string | null }[]): string {
  if (!rows.length) return '没有待发布的项目。';
  return [...rows]
    .sort((a, b) => (b.center ?? -1) - (a.center ?? -1))
    .map((r) => `[${r.id}] ${r.title} · ${KIND_LABEL[r.kind as PredictKind]} · ${r.center === null ? '暂不预测数字' : `中枢约 ${r.center.toLocaleString('en-US')} · 最可能 ${r.top}`}`)
    .join('\n');
}

/** 展示用: 锁定的优先(录制后 > 定稿), 否则最新草稿 */
export async function latestForDisplay(db: PrismaClient, projectId: string) {
  for (const kind of ['recorded', 'final', 'draft']) {
    const p = await db.prediction.findFirst({ where: { projectId, kind }, orderBy: { createdAt: 'desc' }, include: { check: true } });
    if (p) return toPredictionView(p);
  }
  return null;
}

export const PREDICT_COMMANDS: Command[] = [
  {
    path: ['predict', 'run'],
    tier: 'write',
    hermes: false,
    usage: 'mp predict run <项目>',
    summary: '按当前稿子做一次草稿预测',
    async run(ctx, p) {
      const id = needArg(p, 0, '项目');
      // 命令行是另一个进程, 和页面上的预测互相看不见锁: 先查有没有正在跑的
      if (await ctx.db.job.findFirst({ where: { projectId: id, kind: { startsWith: 'predict_' }, status: { in: ['queued', 'running'] } } })) throw new CliError('running', '正在预测');
      // 占一条任务记录: 页面上的「预测」据此知道命令行在跑, 不会同时再跑一份
      const job = await ctx.db.job.create({ data: { projectId: id, kind: 'predict_draft', status: 'running', progress: 0 } });
      const finish = (status: string, userMessage: string) => ctx.db.job.update({ where: { id: job.id }, data: { status, userMessage } }).catch(() => {});
      try {
        const r = await runPrediction(await createPredictDeps(ctx.db), id, 'draft');
        await finish('done', '命令行预测完成');
        return { text: formatPrediction({ id: r.id, kind: 'draft', createdAt: new Date().toISOString(), formulaVersion: r.formulaVersion, scores: r.scores, result: r.result, check: null }) };
      } catch (e) {
        await finish('failed', e instanceof Error ? e.message : String(e));
        if (e instanceof PredictRefused) throw new CliError('bad_args', e.message);
        throw e;
      }
    },
    format: (d) => (d as { text: string }).text,
  },
  {
    path: ['predict', 'show'],
    tier: 'read',
    hermes: true,
    usage: 'mp predict show <项目>',
    summary: '看项目的流量预测',
    async run(ctx, p) {
      const v = await latestForDisplay(ctx.db, needArg(p, 0, '项目'));
      if (!v) throw new CliError('not_found', '这个项目还没有预测：在项目页点「预测」或 mp predict run');
      return v;
    },
    format: (d) => formatPrediction(d as ReturnType<typeof toPredictionView>),
  },
  {
    path: ['predict', 'list'],
    tier: 'read',
    hermes: true,
    usage: 'mp predict list',
    summary: '待发布项目按预测排序',
    async run(ctx) {
      const projects = await ctx.db.project.findMany({ where: { publishedWorks: { none: {} }, stage: { not: 'draft' } }, select: { id: true, title: true } });
      const rows = [];
      for (const pr of projects) {
        const v = await latestForDisplay(ctx.db, pr.id);
        if (!v) continue;
        const r: PredictionResult = v.result;
        const t = r.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
        rows.push({ id: pr.id, title: pr.title, kind: v.kind, center: r.center, top: t ? `${t.label} ${t.prob}%` : null });
      }
      return rows;
    },
    format: (d) => formatPredictList(d as Parameters<typeof formatPredictList>[0]),
  },
];
