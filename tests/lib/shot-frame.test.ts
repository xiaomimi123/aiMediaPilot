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

describe('竖屏要把版面铺到下半屏', () => {
  const portrait = () =>
    BUILDER.buildSystemPrompt(['#111'], 'card', undefined, undefined, { width: 1080, height: 1920 });

  it('上下两端都要给出具体像素, 不能只说一端', () => {
    const p = portrait();
    expect(p).toContain('96px');   // 1920 的 5%
    expect(p).toContain('1536px'); // 1920 的 80%
  });

  /*
   * 只说「排到 80%」的那一版, 模型把内容整体压到了下半屏, 顶部 55% 全空 ——
   * 上一版是全挤在顶上。两种都错, 只是方向相反, 所以两端都得锁。
   */
  it('明说「全压到底下」也是错的', () => {
    expect(portrait()).toContain('压到底下');
  });

  it('底部要留给字幕 —— 不说的话模型会把字压在字幕上', () => {
    expect(portrait()).toContain('字幕');
  });

  it('横屏不带这些竖屏专属的说法', () => {
    const land = BUILDER.buildSystemPrompt(['#111'], 'card', undefined, undefined, { width: 1920, height: 1080 });
    expect(land).not.toContain('纵向排版');
  });
});
