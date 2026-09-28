import { describe, expect, it, vi } from 'vitest';
import { analyzeVideo, explainAnalyzeError, type AnalyzeDeps } from '@/lib/benchmark/analyze';
import { EgoUnavailableError } from '@/lib/ego';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { StructuredLLM } from '@/lib/script/write';

const analysis = { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签 + 名人背书', fit: 'high', fitReason: '对上内容支柱「效率革命」', myAngle: '用你实测过的工具讲普通人怎么用 AI 解决小问题' };

async function setup(over: Partial<AnalyzeDeps> = {}) {
  const store = createMemoryStore();
  const acc = await store.upsertAccount({ secUid: 'MS4wA', nickname: '园长说AI', douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 }, { status: 'following', source: 'manual' });
  const v = await store.upsertVideo(acc.id, { awemeId: '7676819001574157481', desc: '#余秀华说AI是普通人的诗', url: 'u', publishedAt: new Date(), durationSec: 73, digg: 23417, comment: 0, collect: 0, share: 0, isTop: false, playUrls: [], authorSecUid: 'MS4wA', authorName: '园长说AI' }, new Date());
  const removed: string[] = [];
  const llm = {
    callStructured: vi.fn(async (o: { responseSchema: { safeParse: (x: unknown) => { success: boolean } } }) =>
      o.responseSchema.safeParse({ lines: ['x'] }).success ? { result: { lines: ['很多人对AI的印象还停留在聊天写代码'] }, usage: {} } : { result: analysis, usage: {} },
    ),
  } as unknown as StructuredLLM;
  const deps: AnalyzeDeps = {
    store,
    client: { downloadVideo: vi.fn(async () => {}) },
    transcribe: vi.fn(async () => [{ startSec: 0, endSec: 3, text: '很多人对AI的印象还停留在聊天写代码' }]),
    llm,
    personaText: '内容支柱：效率革命',
    tmpDir: '/tmp',
    removeFile: vi.fn(async (p: string) => {
      removed.push(p);
    }),
    ...over,
  };
  return { store, v, deps, removed };
}

describe('analyzeVideo', () => {
  it('stores transcript and analysis, and deletes the video file', async () => {
    const { store, v, deps, removed } = await setup();
    expect(await analyzeVideo(deps, v.id)).toBe(true);
    expect(store.videos[0]).toMatchObject({ analysisStatus: 'done', analysisError: null, transcript: '很多人对AI的印象还停留在聊天写代码' });
    expect((store.videos[0].analysis as { fit: string }).fit).toBe('high');
    expect(removed).toEqual(['/tmp/bm-7676819001574157481.mp4']);
  });
  it('marks failure with a reason, still deletes the file, and can be retried', async () => {
    const { store, v, deps, removed } = await setup({ transcribe: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await analyzeVideo(deps, v.id)).toBe(false);
    expect(store.videos[0].analysisStatus).toBe('failed');
    expect(store.videos[0].analysisError).toContain('转写失败');
    expect(removed).toHaveLength(1);
    deps.transcribe = vi.fn(async () => [{ startSec: 0, endSec: 3, text: '很多人对AI的印象还停留在聊天写代码' }]);
    expect(await analyzeVideo(deps, v.id)).toBe(true);
    expect(store.videos[0].analysisError).toBeNull();
  });
  it('fails clearly without a DeepSeek key', async () => {
    const { store, v, deps } = await setup({ llm: null });
    expect(await analyzeVideo(deps, v.id)).toBe(false);
    expect(store.videos[0].analysisError).toContain('设置页');
  });
  it('explains an ego failure in Chinese', () => {
    expect(explainAnalyzeError(new EgoUnavailableError('x'))).toContain('打开 ego lite 重新登录');
  });
});
