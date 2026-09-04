import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

/*
 * 三十期 Task 3 反向断言: 旧渲染层已成建制删除, 只剩 Remotion 一条渲染路径。
 *
 * 原测试断言"新旧两条渲染路径同时存在"(先建后拆); 旧链验收通过并删除后,
 * 这条断言反过来——旧的 handler 不该再出现在 worker 源码里, 旧渲染层的文件
 * 也应该一个都不在。反向改写(不是删掉)是为了继续守住"旧链真的清干净了"
 * 这件事, 而不是让删除失去一份能验证自己的断言。
 */

describe('worker 的渲染分支', () => {
  it('只剩 Remotion 一条渲染路径, 旧 handler 不再出现', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(process.cwd() + '/src/jobs/workers/video-production-worker.ts', 'utf-8'));
    // \b 本身就不会在 "handlePptNarrationRemotion" 内部匹配出 "handlePptNarration"
    // (二者之间没有单词边界, R 与 n 都是单词字符)——不需要额外的否定前瞻。
    // 原弱断言(旧版本只用 toContain('handlePptNarration'))在旧 handler 删除后
    // 仍会通过(被 Remotion 变体的字符串子串命中), 是清点报告里点名要收紧的一处。
    expect(src).not.toMatch(/\bhandlePptNarration\b/);
    expect(src).not.toMatch(/\bhandleTalkingHeadBroll\b/);
    expect(src).not.toMatch(/\bhandleIllustrationTts\b/);
    expect(src).toContain('handlePptNarrationRemotion');   // 新的还在
    expect(src).toMatch(/renderer\s*!==\s*'remotion'/);    // legacy 直接拒绝, 不再是分流开关
  });

  it('旧渲染层的文件已成建制删除', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'src/lib/video-production/shot-renderer.ts',
      'src/lib/video-production/ambient-rig.ts',
      'src/lib/video-production/shot-chrome.ts',
      'src/lib/video-production/frame-overlap.ts',
    ]) {
      expect(fs.existsSync(process.cwd() + '/' + f), `${f} 应该已被删除`).toBe(false);
    }
  });
});
