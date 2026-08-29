import { describe, it, expect } from 'vitest';
import { judgeShotLayout } from '@/lib/video-production/frame-layout';

const P = { width: 1080, height: 1920 };
const s = (o: Record<string, unknown> = {}) => ({
  bottomReach: 0.75, contentRatio: 0.05, sideBySide: false, clipped: false, ...o,
});

describe('反馈要带上真实坐标 —— 光说「不要并排」模型三次都改不对', () => {
  it('并排的反馈里给出两块的实际位置和宽度', () => {
    const r = judgeShotLayout(
      [s({ sideBySide: true, sidePair: { ax: 60, aw: 420, bx: 600, bw: 420 } }),
       s({ sideBySide: true, sidePair: { ax: 60, aw: 420, bx: 600, bw: 420 } })],
      P,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('420');
    expect(r.reason).toContain('600');
  });

  it('拿不到坐标时也要能给出通用的反馈', () => {
    const r = judgeShotLayout([s({ sideBySide: true }), s({ sideBySide: true })], P);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('并排');
  });
});

describe('文字被容器裁掉', () => {
  it('多数帧有裁切 → 拦', () => {
    const r = judgeShotLayout([s({ clipped: true }), s({ clipped: true }), s()], P);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('裁');
  });

  it('横屏也要判 —— 文字被裁跟画幅无关', () => {
    const land = { width: 1920, height: 1080 };
    expect(judgeShotLayout([s({ clipped: true }), s({ clipped: true })], land).ok).toBe(false);
  });

  it('个别帧裁切(入场动画的一瞬)不误伤', () => {
    expect(judgeShotLayout([s(), s({ clipped: true }), s()], P).ok).toBe(true);
  });
});
