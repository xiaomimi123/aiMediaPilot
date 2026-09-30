import { z } from 'zod';
import type { Tool, ToolContext } from './types';
import { createPredictDeps, PredictRefused, runPrediction, type PredictDeps } from '@/lib/predict/run';
import { formatPrediction } from '@/lib/predict/view';

const Input = z.object({});

export function makePredictTool(makeDeps: (ctx: ToolContext) => Promise<PredictDeps> = (ctx) => createPredictDeps(ctx.db, ctx.llm)): Tool<z.infer<typeof Input>> {
  return {
    name: 'predict_views',
    label: '预测流量',
    description: '按当前稿子做一次草稿预测：5 项打分、分项预测、播放区间和拖后腿的地方。用户问能不能火 / 测一下时调用；按建议改完可以再测。',
    input: Input,
    async execute(ctx) {
      try {
        const r = await runPrediction(await makeDeps(ctx), ctx.projectId, 'draft');
        return { ok: true, summary: r.summary, data: { text: formatPrediction({ id: r.id, kind: 'draft', createdAt: new Date().toISOString(), formulaVersion: r.formulaVersion, scores: r.scores, result: r.result, check: null }) } };
      } catch (e) {
        const msg = e instanceof PredictRefused ? e.message : e instanceof Error ? e.message : String(e);
        return { ok: false, summary: `预测失败：${msg}`, data: { error: msg } };
      }
    },
  };
}

export const predictTool = makePredictTool();
