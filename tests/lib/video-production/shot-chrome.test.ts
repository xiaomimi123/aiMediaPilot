import { describe, it, expect } from 'vitest';
import { buildShotChrome, hasShotChrome, CHROME_MARKER } from '@/lib/video-production/shot-chrome';

/*
 * 常驻框架层的动因是拆参考片拆出来的(spec §1.6 订正二)。
 *
 * 680 第 180 秒: 一张卡在左、右边三分之二全空 —— 和我们被批评「卡片龟缩左上」的
 * 构图一模一样。它不难看, 是因为画面上有一套始终在场的框架: 系列号 / 章节标签 /
 * 卡片编号 / 底部字幕 / 背景纹理。**我们的空是真空**, 这五样一个都没有。
 *
 * 所以要补的是框架, 不是内容 —— 逼模型把画面填满是反方向, 那正是 frame-detail.ts
 * 当初防的「大色块刷分」。
 */

const base = {
  width: 1920, height: 1080,
  actLabel: '概念A', shotNo: 3, shotTotal: 8,
  shotStartMs: 10000,
  cues: [
    { startMs: 9000, endMs: 10500, text: '上一镜的尾巴' },
    { startMs: 10500, endMs: 13000, text: '这一镜的第一句' },
    { startMs: 13000, endMs: 16000, text: '这一镜的第二句' },
  ],
};

describe('buildShotChrome', () => {
  const js = buildShotChrome(base);

  it('带标记, 好让校验知道这一镜挂没挂上', () => {
    expect(js).toContain(CHROME_MARKER);
    expect(hasShotChrome(`<html><script>${CHROME_MARKER}</script></html>`)).toBe(true);
    expect(hasShotChrome('<html></html>')).toBe(false);
  });

  it('章节标签、镜头编号都在', () => {
    expect(js).toContain('概念A');
    expect(js).toContain('3 / 8');
  });

  it('字幕按镜头起点转成相对时间 —— 渲染器 seek 的是镜头内的秒数, 不是全片', () => {
    // 10500ms 的那句, 相对这一镜(起点 10000ms)是 0.5 秒
    expect(js).toContain('0.5');
    // 上一镜的尾巴(9000ms 起)不该出现在这一镜里
    expect(js).not.toContain('上一镜的尾巴');
    expect(js).toContain('这一镜的第一句');
  });

  it('挂在同一条 shot 时间线上 —— 渲染器靠 seek 这条线截图', () => {
    expect(js).toContain("__timelines");
    expect(js).toContain("'shot'");
  });

  it('没有六幕信息时不画章节标签, 而不是画一个空标签', () => {
    const js2 = buildShotChrome({ ...base, actLabel: null });
    expect(js2).toContain('3 / 8');   // 编号照旧
    expect(js2).not.toMatch(/chapter-label/);
  });

  it('框架层不许挡住内容 —— 全部 pointer-events:none 且贴边', () => {
    expect(js).toContain('pointer-events:none');
  });
});
