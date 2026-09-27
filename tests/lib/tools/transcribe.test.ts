import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../../helpers/fake-db';

// vi.mock 会被提升到文件顶部, 工厂里只能用 vi.hoisted 定义的变量
const { launchJob } = vi.hoisted(() => ({ launchJob: vi.fn(async () => ({ jobId: 'jNew', finished: Promise.resolve() })) }));
vi.mock('@/lib/jobs/registry', () => ({ launchJob }));

import { transcribeTool } from '@/lib/tools/transcribe';
const ctx = (db: ReturnType<typeof createFakeDb>['db']) => ({ projectId: 'p1', db, llm: {} as never });

describe('transcribe tool', () => {
  it('refuses when no video was uploaded', async () => {
    const { db } = createFakeDb();
    expect(await transcribeTool.execute(ctx(db), {})).toMatchObject({ ok: false, summary: '转写没开始：还没上传口播视频' });
  });
  it('refuses when a transcription is already running', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video' }], jobs: [{ status: 'running' }] });
    expect(await transcribeTool.execute(ctx(db), {})).toMatchObject({ ok: false, summary: '转写没开始：已经在转写了' });
  });
  it('starts a background job', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video' }] });
    const r = await transcribeTool.execute(ctx(db), {});
    expect(r).toMatchObject({ ok: true, summary: '已开始重新转写，1～3 分钟后出结果' });
    expect(launchJob).toHaveBeenCalledWith(db, 'p1', 'transcribe');
  });
});
