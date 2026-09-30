import type { PrismaClient } from '@prisma/client';
import { startExclusiveJob, type JobRun } from './runner';
import { runTranscribe } from '@/lib/recording/transcribe';
import { createTranscribeDeps } from '@/lib/recording/deps';
import { predictJob } from '@/lib/predict/run';

/** 所有后台任务种类。上传、重试、agent 工具都从这里启动, 保证同一种任务只有一种跑法。 */
export const JOB_KINDS = {
  transcribe: {
    label: '转写',
    run: (async (ctx) => {
      const out = await runTranscribe(ctx, createTranscribeDeps());
      // 转写成功后按实际口播锁定一版预测; 失败不影响转写
      await launchJob(ctx.db, ctx.projectId, 'predict_recorded').catch(() => null);
      return out;
    }) as JobRun,
  },
  predict_draft: { label: '预测', run: predictJob('draft') },
  predict_final: { label: '定稿预测', run: predictJob('final') },
  predict_recorded: { label: '录制后预测', run: predictJob('recorded') },
} as const;

export type JobKind = keyof typeof JOB_KINDS;

export function isJobKind(k: string): k is JobKind {
  return k in JOB_KINDS;
}

/** 同类任务已在跑时返回 null(不重复启动) */
export function launchJob(db: PrismaClient, projectId: string, kind: JobKind) {
  const def = JOB_KINDS[kind];
  return startExclusiveJob(db, { projectId, kind, label: def.label, run: def.run });
}
