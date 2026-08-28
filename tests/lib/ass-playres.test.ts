import { describe, it, expect } from 'vitest';
import { buildAssCaptions } from '@/lib/video-production/ass-captions';

const style = {
  fontFamily: 'PingFang SC' as const,
  fontSize: 56,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  marginV: 90,
};
const events = [{ startMs: 0, endMs: 1000, text: '一句字幕' }];

describe('ASS PlayRes —— 字号必须按画面像素解释', () => {
  it('**写出 PlayResX/PlayResY** —— 缺了它 libass 按 384×288 解释字号', () => {
    const ass = buildAssCaptions(events, style, { width: 1080, height: 1920 });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it('横屏也按真实尺寸写', () => {
    const ass = buildAssCaptions(events, style, { width: 1920, height: 1080 });
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
  });

  it('不给尺寸时**不写 PlayRes**, 保持老行为 —— 已有任务不该因为这次改动变样', () => {
    const ass = buildAssCaptions(events, style);
    expect(ass).not.toContain('PlayResX');
  });

  it('字号原样写进样式行, 不做任何换算', () => {
    const ass = buildAssCaptions(events, style, { width: 1080, height: 1920 });
    expect(ass).toContain(',56,');
  });

  it('PlayRes 写在 Script Info 段里 —— 放错段落 libass 会忽略', () => {
    const ass = buildAssCaptions(events, style, { width: 1080, height: 1920 });
    expect(ass.indexOf('PlayResX')).toBeGreaterThan(ass.indexOf('[Script Info]'));
    expect(ass.indexOf('PlayResX')).toBeLessThan(ass.indexOf('[V4+ Styles]'));
  });
});
