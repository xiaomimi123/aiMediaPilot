import { describe, it, expect } from 'vitest';
import { BUILDER } from '@/lib/video-production/builder-prompt';

describe('Builder 要知道真实画布', () => {
  it('竖屏时 prompt 里写的是竖屏尺寸', () => {
    const p = BUILDER.buildSystemPrompt(['#111'], 'card', undefined, undefined, { width: 1080, height: 1920 });
    expect(p).toContain('1080x1920');
    expect(p).not.toContain('画布尺寸固定 1920x1080');
  });

  it('不给画幅时保持老行为 —— 横屏 1920x1080', () => {
    expect(BUILDER.buildSystemPrompt(['#111'])).toContain('1920x1080');
  });

  it('竖屏要明说排版方向, 不能让模型按横屏铺', () => {
    const p = BUILDER.buildSystemPrompt(['#111'], 'card', undefined, undefined, { width: 1080, height: 1920 });
    expect(p).toMatch(/竖|纵向|上下/);
  });
});
