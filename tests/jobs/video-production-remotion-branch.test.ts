import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

/*
 * 先建后拆的验证: 新分支存在, 且**旧分支原样保留**。
 *
 * 这个项目栽过"边建边拆"的相反面 —— 二十三期把检查写完不接线, 直到真机出片才发现
 * 一直没在跑。这里反过来: 两套都在, 由 renderer 字段选, 出问题能立刻退回旧链路。
 */

describe('worker 的渲染分支', () => {
  it('新旧两条渲染路径同时存在', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(process.cwd() + '/src/jobs/workers/video-production-worker.ts', 'utf-8'));
    expect(src).toContain('handlePptNarration');           // 旧的还在
    expect(src).toContain('handlePptNarrationRemotion');   // 新的加上了
    expect(src).toMatch(/renderer\s*===\s*'remotion'/);    // 有分流开关
  });

  it('旧渲染层的文件一个都没删 —— 本期先建后拆', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'src/lib/video-production/shot-renderer.ts',
      'src/lib/video-production/ambient-rig.ts',
      'src/lib/video-production/shot-chrome.ts',
      'src/lib/video-production/frame-overlap.ts',
    ]) {
      expect(fs.existsSync(process.cwd() + '/' + f), `${f} 被删了`).toBe(true);
    }
  });
});
