import { describe, it, expect } from 'vitest';
import { ASPECTS, ASPECT_LABELS, frameOfAspect, aspectOfFrame } from '@/lib/video-template/aspect';

describe('frameOfAspect', () => {
  it('竖屏 9:16 → 1080x1920', () => {
    expect(frameOfAspect('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('横屏 16:9 → 1920x1080', () => {
    expect(frameOfAspect('16:9')).toEqual({ width: 1920, height: 1080 });
  });

  it('没设过的老模板按横屏 —— 零迁移, 和改动前一致', () => {
    expect(frameOfAspect(null)).toEqual({ width: 1920, height: 1080 });
    expect(frameOfAspect(undefined)).toEqual({ width: 1920, height: 1080 });
  });

  it('乱值也退回横屏, 不抛', () => {
    expect(frameOfAspect('4:3' as never)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('aspectOfFrame', () => {
  it('真人出镜按素材反推 —— 素材竖就是竖', () => {
    expect(aspectOfFrame({ width: 1080, height: 1920 })).toBe('9:16');
    expect(aspectOfFrame({ width: 1920, height: 1080 })).toBe('16:9');
  });

  it('正方形算横屏', () => {
    expect(aspectOfFrame({ width: 1000, height: 1000 })).toBe('16:9');
  });
});

describe('两个常量表', () => {
  it('每个画幅都有中文名', () => {
    for (const a of ASPECTS) expect(ASPECT_LABELS[a].length).toBeGreaterThan(1);
  });
});
