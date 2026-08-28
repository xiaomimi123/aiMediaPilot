import { describe, it, expect } from 'vitest';
import { buildPreviewHtml } from '@/lib/video-production/preview-html';

const GSAP = 'GSAP_SOURCE_HERE';
const opts = { gsapSource: GSAP, durationMs: 12200 };

const withTag = `<!DOCTYPE html><html><head><script src="gsap.min.js"></script></head><body><div>x</div></body></html>`;

describe('buildPreviewHtml', () => {
  it('**把 gsap 内联进去** —— iframe 里没有那个本地文件路径', () => {
    const r = buildPreviewHtml(withTag, opts);
    expect(r.html).toContain(GSAP);
    expect(r.html).not.toContain('src="gsap.min.js"');
    expect(r.gsapInlined).toBe(true);
  });

  it('单引号写法也认', () => {
    const r = buildPreviewHtml(`<head><script src='gsap.min.js'></script></head><body></body>`, opts);
    expect(r.gsapInlined).toBe(true);
    expect(r.html).toContain(GSAP);
  });

  it('没有 gsap 引用时补进 head, 并报告没内联成 —— 那说明 Builder 没按契约输出', () => {
    const r = buildPreviewHtml('<html><head></head><body></body></html>', opts);
    expect(r.gsapInlined).toBe(false);
    expect(r.html).toContain(GSAP);
  });

  it('连 head 都没有也不丢 gsap', () => {
    const r = buildPreviewHtml('<div>裸片段</div>', opts);
    expect(r.html).toContain(GSAP);
    expect(r.html).toContain('裸片段');
  });

  it('**注入播放器** —— Builder 的时间线是暂停态的, 不主动播就是一张静止画面', () => {
    const r = buildPreviewHtml(withTag, opts);
    expect(r.html).toContain('__timelines');
    expect(r.html).toContain('tl.play(0)');
  });

  it('播放器排在 body 末尾, 在 Builder 自己的脚本之后', () => {
    const r = buildPreviewHtml(withTag, opts);
    expect(r.html.indexOf('tl.play(0)')).toBeGreaterThan(r.html.indexOf('<div>x</div>'));
  });

  it('时长传进播放器, 进度条才有量程', () => {
    expect(buildPreviewHtml(withTag, opts).html).toContain('12200');
  });

  it('循环可关', () => {
    expect(buildPreviewHtml(withTag, { ...opts, loop: false }).html).toContain('LOOP = false');
    expect(buildPreviewHtml(withTag, opts).html).toContain('LOOP = true');
  });

  it('等不到时间线要把原因显示出来 —— 静止画面和「这一镜本来就静止」分不出来', () => {
    expect(buildPreviewHtml(withTag, opts).html).toContain('渲染时会失败');
  });

  it('原始内容一个字不动', () => {
    expect(buildPreviewHtml(withTag, opts).html).toContain('<div>x</div>');
  });
});
