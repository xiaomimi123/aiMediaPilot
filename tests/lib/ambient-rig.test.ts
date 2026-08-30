import { describe, it, expect } from 'vitest';
import { buildAmbientRig, AMBIENT_MARKER } from '@/lib/video-production/ambient-rig';

describe('buildAmbientRig —— 让任何一帧都不完全静止', () => {
  const js = buildAmbientRig({ width: 1080, height: 1920, durationMs: 20000 });

  it('挂在 shot 时间线上, 和镜头动画同一条时间轴', () => {
    expect(js).toContain('__timelines');
    expect(js).toContain('shot');
  });

  it('相机层是**连续曲线**, 不是一次性入场', () => {
    // 整段时长都要覆盖到, 否则后半段又是死的
    expect(js).toContain('20');
    expect(js).toMatch(/scale|translate/);
  });

  it('环境层有呼吸(周期性), 不是单向渐变', () => {
    expect(js).toMatch(/yoyo|repeat/);
  });

  it('振幅要小 —— 大了就成了晃镜头, 观众会晕', () => {
    const m = js.match(/scale:\s*([\d.]+)/);
    if (m) expect(Number(m[1])).toBeLessThan(1.08);
  });

  it('带标记, 好让校验知道这一镜挂没挂上', () => {
    expect(js).toContain(AMBIENT_MARKER);
  });
});

describe('hasAmbientRig', () => {
  it('认得出挂过的 HTML', async () => {
    const { hasAmbientRig } = await import('@/lib/video-production/ambient-rig');
    expect(hasAmbientRig(`<html><script>${AMBIENT_MARKER}</script></html>`)).toBe(true);
    expect(hasAmbientRig('<html></html>')).toBe(false);
  });
});
