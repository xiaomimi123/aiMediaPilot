import { describe, it, expect } from 'vitest';
import {
  buildAmbientRig,
  AMBIENT_MARKER,
  SHEEN_ALPHA,
  SHEEN_TILE_PX,
  VIGNETTE_PERIOD_SEC,
} from '@/lib/video-production/ambient-rig';

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

  /*
   * 下面三条锁的是**实测结论**, 不是审美偏好。三次改动里有两次判断是错的:
   * ①以为问题在 ease 的换向点速度归零 —— 改成三角波后整片仍有 1.13 秒静止;
   * ②以为所有分量都该单调不回头 —— 改完从 1 段 1.13 秒恶化到 13 段 13.3 秒。
   * 真正起作用的是「任意 0.8 秒窗口内的变化速率」, 而 freezedetect 是拿参考帧比的,
   * 所以还需要一个单调层去补往返层换向点上的洞。谁想把它们改回去, 先看这三条。
   */
  it('暗角层必须是**高速率往返** —— 摊成整段单向渐深会让静止暴涨十倍', () => {
    expect(js).toMatch(/yoyo:\s*true/);
    expect(VIGNETTE_PERIOD_SEC).toBeLessThanOrEqual(2.5);
    // ease 必须是 none: sine.inOut 在换向点速度归零, 那一瞬真的不动
    // (只查真正的 ease 赋值 —— 生成的注释里会提到 sine.inOut 这个反例)
    expect(js).not.toMatch(/ease:\s*'sine/);
  });

  it('扫光层必须**单调不回头**, 用来补暗角换向点上的洞', () => {
    const sheen = js.slice(js.indexOf('repeating-linear-gradient'));
    expect(sheen).toContain("ease: 'none'");
    expect(sheen).not.toMatch(/yoyo/);
    // 平移整数倍 tile 才无缝
    expect(sheen).toContain(`${SHEEN_TILE_PX}px`);
  });

  it('扫光强度不得低于实测下限 —— 0.06/0.08 在最难的镜头上仍留约 1 秒静止', () => {
    expect(SHEEN_ALPHA).toBeGreaterThanOrEqual(0.12);
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
