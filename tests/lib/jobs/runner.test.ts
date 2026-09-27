import { describe, expect, it } from 'vitest';
import { startJob, reconcileInterruptedJobs, findActiveJob, JobError } from '@/lib/jobs/runner';
import { createFakeDb } from '../../helpers/fake-db';

describe('startJob', () => {
  it('runs in the background, marks done, and posts a success notice to chat', async () => {
    const { db, jobs, messages } = createFakeDb();
    // 用闸门卡住任务, 保证检查"运行中"时它确实还没跑完(否则是竞态)
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { jobId, finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async (ctx) => { await ctx.progress(0.5); await gate; return { notice: '转写完成：12 句' }; },
    });
    expect(jobs.find((j) => j.id === jobId)?.status).toBe('running');
    open();
    await finished;
    expect(jobs[0]).toMatchObject({ status: 'done', progress: 1, userMessage: '转写完成：12 句' });
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: '转写完成：12 句', toolName: 'job:transcribe', toolResult: { ok: true } });
  });

  it('uses JobError.userMessage for the user and keeps the detail separately', async () => {
    const { db, jobs, messages } = createFakeDb();
    const { finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async () => { throw new JobError('还没有口播视频，先上传一个再转写。', 'no raw_video row'); },
    });
    await finished;
    expect(jobs[0]).toMatchObject({ status: 'failed', userMessage: '还没有口播视频，先上传一个再转写。', errorDetail: 'no raw_video row' });
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: '还没有口播视频，先上传一个再转写。', toolResult: { ok: false } });
  });

  it('gives a generic plain-Chinese message for unexpected errors, stack goes to detail', async () => {
    const { db, jobs } = createFakeDb();
    const { finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async () => { throw new TypeError('Cannot read properties of undefined'); },
    });
    await finished;
    expect(jobs[0].userMessage).toBe('转写没完成：出了意外错误。点「重试」再跑一次，还不行就把详情发给我。');
    expect(jobs[0].errorDetail).toContain('TypeError: Cannot read properties of undefined');
  });
});

describe('reconcileInterruptedJobs', () => {
  it('marks jobs left running by a previous process as interrupted', async () => {
    const boot = new Date('2026-09-27T10:00:00Z');
    const { db, jobs } = createFakeDb({
      jobs: [
        { status: 'running', updatedAt: new Date('2026-09-27T09:59:00Z') },
        { status: 'running', updatedAt: new Date('2026-09-27T10:00:05Z') },
        { status: 'done', updatedAt: new Date('2026-09-27T09:00:00Z') },
      ],
    });
    expect(await reconcileInterruptedJobs(db, boot)).toBe(1);
    expect(jobs.map((j) => j.status)).toEqual(['interrupted', 'running', 'done']);
    expect(jobs[0].userMessage).toBe('服务重启打断了这个任务，点「重试」重新跑。');
  });
});

describe('findActiveJob', () => {
  it('returns the running job and ignores finished ones', async () => {
    const { db } = createFakeDb({ jobs: [{ status: 'done' }, { status: 'running' }] });
    expect(await findActiveJob(db, 'p1', 'transcribe')).not.toBeNull();
    const empty = createFakeDb({ jobs: [{ status: 'failed' }] });
    expect(await findActiveJob(empty.db, 'p1', 'transcribe')).toBeNull();
  });
});
