import type { PrismaClient } from '@prisma/client';

/**
 * 进程内任务执行器(spec §5.1): 不要 Redis/worker, 任务在 web 进程里跑, 状态落 Job 表。
 * 代价是热重载或重启会打断任务 —— 用 reconcileInterruptedJobs 把残留的标成"已中断",
 * 由用户点重试, 绝不自动重跑。
 */

/** 给用户看的失败原因(中文, 原因 + 怎么办); detail 只进 errorDetail。 */
export class JobError extends Error {
  constructor(
    public userMessage: string,
    public detail?: unknown,
  ) {
    super(userMessage);
  }
}

export interface JobContext {
  jobId: string;
  projectId: string;
  db: PrismaClient;
  progress(p: number): Promise<void>;
}
export interface JobOutcome {
  notice: string;
}
export type JobRun = (ctx: JobContext) => Promise<JobOutcome>;

// 挂在 globalThis 上: 热重载会重新执行本模块, 但同一进程里的启动时间不能变,
// 否则正在跑的任务会被误判成"上个进程留下的"
const g = globalThis as unknown as { __mpBootAt?: Date };
export const BOOT_AT: Date = (g.__mpBootAt ??= new Date());

const detailOf = (e: unknown): string =>
  e instanceof JobError ? (e.detail instanceof Error ? e.detail.stack ?? e.detail.message : String(e.detail ?? '')) : e instanceof Error ? e.stack ?? e.message : String(e);

export async function startJob(
  db: PrismaClient,
  opts: { projectId: string; kind: string; label: string; run: JobRun },
): Promise<{ jobId: string; finished: Promise<void> }> {
  const job = await db.job.create({ data: { projectId: opts.projectId, kind: opts.kind, status: 'running', progress: 0 } });
  const ctx: JobContext = {
    jobId: job.id,
    projectId: opts.projectId,
    db,
    progress: async (p) => {
      await db.job.update({ where: { id: job.id }, data: { progress: Math.max(0, Math.min(1, p)) } });
    },
  };
  const post = (content: string, ok: boolean) =>
    db.chatMessage.create({ data: { projectId: opts.projectId, role: 'system', content, toolName: `job:${opts.kind}`, toolResult: { ok } } });

  const finished = (async () => {
    try {
      const out = await opts.run(ctx);
      await db.job.update({ where: { id: job.id }, data: { status: 'done', progress: 1, userMessage: out.notice } });
      await post(out.notice, true);
    } catch (e) {
      const userMessage =
        e instanceof JobError ? e.userMessage : `${opts.label}没完成：出了意外错误。点「重试」再跑一次，还不行就把详情发给我。`;
      try {
        await db.job.update({ where: { id: job.id }, data: { status: 'failed', userMessage, errorDetail: detailOf(e) } });
        await post(userMessage, false);
      } catch (inner) {
        console.error('[job] 写失败状态时出错', inner);
      }
    }
  })();
  return { jobId: job.id, finished };
}

export async function reconcileInterruptedJobs(db: PrismaClient, bootAt: Date = BOOT_AT): Promise<number> {
  const r = await db.job.updateMany({
    where: { status: { in: ['queued', 'running'] }, updatedAt: { lt: bootAt } },
    data: { status: 'interrupted', userMessage: '服务重启打断了这个任务，点「重试」重新跑。' },
  });
  return r.count;
}

export async function findActiveJob(db: PrismaClient, projectId: string, kind: string): Promise<{ id: string } | null> {
  return db.job.findFirst({ where: { projectId, kind, status: { in: ['queued', 'running'] } }, select: { id: true } });
}
