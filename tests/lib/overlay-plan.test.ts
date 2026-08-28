import { describe, it, expect } from 'vitest';
import {
  buildOverlayAss, buildOverlayEvents, buildDisclaimerEvent, slotPosition,
  REFERENCE_OVERLAY_STYLE, type OverlayItem,
} from '@/lib/video-production/overlay-plan';

const frame = { width: 1280, height: 720 };
const style = REFERENCE_OVERLAY_STYLE;

const item = (over: Partial<OverlayItem> = {}): OverlayItem => ({
  kind: 'keyword', text: '用内容', slot: 'left-1', startMs: 1000, endMs: 4000, ...over,
});

describe('slotPosition', () => {
  it('**左列左对齐(an4)** —— 竖向堆叠成图解时居中会歪歪扭扭', () => {
    expect(slotPosition('left-1', frame).an).toBe(4);
    expect(slotPosition('left-3', frame).x).toBe(slotPosition('left-1', frame).x);
  });

  it('左列五格自上而下递增, 且都在画面内', () => {
    const ys = ['left-1', 'left-2', 'left-3', 'left-4', 'left-5'].map(
      (s) => slotPosition(s as never, frame).y,
    );
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBeGreaterThan(0);
    expect(ys[4]).toBeLessThan(frame.height);
  });

  it('**左列全在画面左半边** —— 人在右半边是这个风格的拍摄前提', () => {
    for (const s of ['left-1', 'left-5'] as const) {
      expect(slotPosition(s, frame).x).toBeLessThan(frame.width / 2);
    }
  });

  it('顶部/底部居中用对应锚点', () => {
    expect(slotPosition('top-center', frame).an).toBe(8);
    expect(slotPosition('bottom-center', frame).an).toBe(2);
  });

  it('竖屏也算得对, 不写死横屏', () => {
    const p = slotPosition('left-3', { width: 1080, height: 1920 });
    expect(p.x).toBeLessThan(540);
    expect(p.y).toBeLessThan(1920);
  });
});

describe('buildOverlayEvents', () => {
  it('关键词用蓝色和大字号', () => {
    const [e] = buildOverlayEvents([item()], style, frame);
    expect(e).toContain('\\fs70'); // 720 * 0.097
    expect(e).toContain('&H00E87814'); // #1478E8 → ASS 是 BGR 序
  });

  it('说明用白色和小字号 —— 两层靠颜色和字号区分', () => {
    const [e] = buildOverlayEvents([item({ kind: 'note', text: '解决什么需求' })], style, frame);
    expect(e).toContain('\\fs40'); // 720 * 0.055
    expect(e).toContain('&H00FFFFFF');
  });

  it('**零长或倒置的时间直接丢掉** —— ASS 会渲染成永不出现的鬼影, 极难定位', () => {
    expect(buildOverlayEvents([item({ startMs: 3000, endMs: 3000 })], style, frame)).toEqual([]);
    expect(buildOverlayEvents([item({ startMs: 5000, endMs: 1000 })], style, frame)).toEqual([]);
  });

  it('空文字丢掉, 不生成一条什么都不显示的事件', () => {
    expect(buildOverlayEvents([item({ text: '  ' })], style, frame)).toEqual([]);
  });

  it('箭头没给文字时默认向下 —— 竖向堆叠是这个风格的主形态', () => {
    const [e] = buildOverlayEvents([item({ kind: 'arrow', text: '' })], style, frame);
    expect(e).toContain('↓');
  });

  it('换行转成 ASS 的 \\N —— 裸换行会把一条事件撕成两半后半条被丢弃', () => {
    const [e] = buildOverlayEvents([item({ text: '上\n下' })], style, frame);
    expect(e).toContain('上\\N下');
    expect(e.split('\n')).toHaveLength(1);
  });

  it('每条都带描边 —— 真人画面的背景不可控, 没描边会读不出来', () => {
    const [e] = buildOverlayEvents([item()], style, frame);
    expect(e).toContain('\\bord');
    expect(e).toContain('\\3c');
  });

  it('带淡入淡出 —— 硬切在真人画面上很跳', () => {
    expect(buildOverlayEvents([item()], style, frame)[0]).toContain('\\fad(200,200)');
  });
});

describe('buildDisclaimerEvent', () => {
  it('三行合成一条, 全片常驻', () => {
    const e = buildDisclaimerEvent(['纯知识经验分享', '不售卖任何项目', '不招募任何人员'], 147000, frame)!;
    expect(e).toContain('纯知识经验分享\\N不售卖任何项目\\N不招募任何人员');
    expect(e).toContain('0:00:00.00');
  });

  it('半透明且比正文小 —— 它是声明不是内容', () => {
    const e = buildDisclaimerEvent(['一行'], 1000, frame)!;
    expect(e).toContain('\\alpha');
    expect(e).toContain('\\fs20'); // 720 * 0.028
  });

  it('空内容或零时长返回 null, 不生成空事件', () => {
    expect(buildDisclaimerEvent([], 1000, frame)).toBeNull();
    expect(buildDisclaimerEvent(['x'], 0, frame)).toBeNull();
    expect(buildDisclaimerEvent(['  ', ''], 1000, frame)).toBeNull();
  });
});

describe('buildOverlayAss', () => {
  it('**必须写 PlayRes** —— 缺了它 libass 按 384×288 解释字号和坐标, 全错', () => {
    const ass = buildOverlayAss([item()], style, frame);
    expect(ass).toContain('PlayResX: 1280');
    expect(ass).toContain('PlayResY: 720');
  });

  it('声明排在叠加之前 —— 它是底层, 不该盖住关键词', () => {
    const ass = buildOverlayAss([item()], style, frame, { disclaimer: ['声明'], durationMs: 5000 });
    expect(ass.indexOf('声明')).toBeLessThan(ass.indexOf('用内容'));
  });

  it('没有任何条目时仍是合法 ASS(只有头)', () => {
    const ass = buildOverlayAss([], style, frame);
    expect(ass).toContain('[Events]');
    expect(ass).toContain('[V4+ Styles]');
  });
});
