import type { PrismaClient } from '@prisma/client';
import { startExclusiveJob, type JobRun } from './runner';
import { runTranscribe } from '@/lib/recording/transcribe';
import { createTranscribeDeps } from '@/lib/recording/deps';

/** 所有后台任务种类。上传、重试、agent 工具都从这里启动, 保证同一种任务只有一种跑法。 */
export const JOB_KINDS = {
  transcribe: { label: '转写', run: ((ctx) => runTranscribe(ctx, createTranscribeDeps())) as JobRun },
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
