// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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

/*
 * 运行时行为(真机验证抓出来的坑, 补回归网)。
 *
 * 上面那组测试全是字符串体检——只看 buildShotChrome 吐出来的 JS 文本里有没有
 * 某个子串, 从不执行它。真机验证时踩过的 bug 恰恰是字符串体检测不出来的那类:
 * 第一版用 tl.call() 挂字幕, 文本体检全过(`0.5`、`这一镜的第一句` 都在), 但
 * GSAP 的 tl.seek() 默认 suppressEvents=true, 渲染器逐帧靠的正是 tl.seek()——
 * 于是 .call() 回调永远不触发, 字幕在真机上是空的。
 *
 * 这里真正执行 buildShotChrome 产出的脚本(用一个最小 stub 时间线模拟
 * window.__timelines['shot']), 反复调用 wrapped 之后的 tl.seek(), 断言
 * cap 的文本在「字幕区间内」「两句之间的空档」「最后一句结束之后」这三种
 * 时刻都对——只测「有字幕时显示」不够, 清空逻辑同样是这次改动的一部分。
 */
describe('buildShotChrome 注入后的运行时行为', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { __timelines?: unknown }).__timelines;
  });

  /** 挂一条最小 stub 时间线, 模拟渲染器逐帧 seek(); 记录/透传自己的返回值。 */
  function stubTimeline() {
    const SEEK_RETURN = { marker: 'original-seek-return' };
    let t = 0;
    const tl = {
      seek(position: number, _suppressEvents?: boolean) {
        t = position;
        return SEEK_RETURN;
      },
      time() {
        return t;
      },
    };
    (window as unknown as { __timelines: Record<string, unknown> }).__timelines = { shot: tl };
    return { tl, SEEK_RETURN };
  }

  /** 预览字幕 div: 唯一一个 textAlign:center 的 fixed 定位 div。 */
  function captionText(): string {
    const div = Array.from(document.querySelectorAll('div')).find(
      (d) => d.style.position === 'fixed' && d.style.textAlign === 'center',
    );
    return div?.textContent ?? '';
  }

  const cues = [
    { startMs: 0, endMs: 2000, text: '第一句' },
    { startMs: 3000, endMs: 5000, text: '第二句' },
  ];

  it('seek 到某句字幕的区间内 —— 显示该句', () => {
    const { tl } = stubTimeline();
    // eslint-disable-next-line no-new-func
    new Function(buildShotChrome({
      width: 1920, height: 1080, actLabel: null, shotNo: 1, shotTotal: 1, shotStartMs: 0, cues,
    }))();
    tl.seek(1);
    expect(captionText()).toBe('第一句');
    tl.seek(4);
    expect(captionText()).toBe('第二句');
  });

  it('seek 到两句字幕之间的空档 —— 清空', () => {
    const { tl } = stubTimeline();
    // eslint-disable-next-line no-new-func
    new Function(buildShotChrome({
      width: 1920, height: 1080, actLabel: null, shotNo: 1, shotTotal: 1, shotStartMs: 0, cues,
    }))();
    tl.seek(2.5); // 第一句已结束(2s), 第二句还没开始(3s)
    expect(captionText()).toBe('');
  });

  it('seek 到最后一句结束之后 —— 清空, 不会一直挂着最后一句', () => {
    const { tl } = stubTimeline();
    // eslint-disable-next-line no-new-func
    new Function(buildShotChrome({
      width: 1920, height: 1080, actLabel: null, shotNo: 1, shotTotal: 1, shotStartMs: 0, cues,
    }))();
    // 先 seek 到第二句里面, 确认它先真的显示出来过——不然下面的"清空"断言
    // 测不出「从有到无」, 只是巧合地一直是空的。
    tl.seek(4);
    expect(captionText()).toBe('第二句');
    tl.seek(6);
    expect(captionText()).toBe('');
  });

  it('包装后的 tl.seek 仍把原时间线自己的返回值透传出去 —— 渲染器可能依赖链式调用', () => {
    const { tl, SEEK_RETURN } = stubTimeline();
    // eslint-disable-next-line no-new-func
    new Function(buildShotChrome({
      width: 1920, height: 1080, actLabel: null, shotNo: 1, shotTotal: 1, shotStartMs: 0, cues,
    }))();
    expect(tl.seek(1)).toBe(SEEK_RETURN);
  });
});
