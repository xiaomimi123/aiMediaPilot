import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { renderShotStill } from '@/lib/video-production/remotion-render';

/*
 * style 是否真的作用到画面 —— 断言 JSX 没有意义(参数可能被读了却没用),
 * 只有真渲染出两张图、比像素才说明问题。手法照 remotion-source-video.test.ts。
 * 见 task-3-brief.md Step 1。
 */
const shot = (style?: unknown) => ({
  shotId: 's1', startMs: 0, endMs: 4000, card: 'statement' as const,
  slots: { text: '强调色测试', sub: '副句' }, ...(style ? { style } : {}),
});

const renderAt = async (style: unknown, name: string) => {
  const out = path.join(os.tmpdir(), `style-${name}-${Date.now()}.png`);
  await renderShotStill({
    input: {
      shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
      sourceVideo: null, aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs: 2000, outputPath: out,
  });
  return out;
};

describe('style 真的作用到画面', () => {
  it('accent 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 'default');
    const b = await renderAt({ accent: 'red' }, 'red');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('scale 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 's1');
    const b = await renderAt({ scale: 1.4 }, 's14');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('speed 不同 → 同一时刻的动效进度不同 → 像素不同', async () => {
    // atMs 取动效进行中的时刻(0.3s 起, 0.42s 时长 —— 500ms 处正在动)
    const out1 = path.join(os.tmpdir(), `sp1-${Date.now()}.png`);
    const out2 = path.join(os.tmpdir(), `sp2-${Date.now()}.png`);
    const mk = async (style: unknown, o: string) => renderShotStill({
      input: {
        shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
        sourceVideo: null, aspect: '16:9', visualStyle: 'card',
      }, shotIndex: 0, atMs: 500, outputPath: o,
    });
    await mk(undefined, out1);
    await mk({ speed: 3 }, out2);
    expect(fs.readFileSync(out1).equals(fs.readFileSync(out2))).toBe(false);
    fs.unlinkSync(out1); fs.unlinkSync(out2);
  }, 120_000);
});
