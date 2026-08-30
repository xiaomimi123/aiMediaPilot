// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TimelineEditor } from '@/components/templates/timeline-editor';

// 画布用 ResizeObserver 跟随容器宽度, jsdom 里没有这个 API
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/*
 * 这个编辑台被两个页面共用(成片详情的版面编辑 + 模板试做台), 所以它的尺寸行为
 * 是接口的一部分。锁住的两条都是真机上量出来的:
 *
 * ① **画布按宽度定尺寸**(`max-w-md` + aspectRatio)。9:16 下实测被撑到 504x896,
 *    把成片详情页顶成 3.17 屏、主操作落到 2400px 处。`canvasMaxHeightPx` 就是为这个
 *    加的, 而它必须给**确定的 height** —— 第一版写成 `maxHeight + width:auto`,
 *    两个方向都没有确定值, 画布真机上塌成 2x4 像素。
 * ② 不给 `canvasMaxHeightPx` 时必须保持老行为, 否则试做台会跟着一起变小 ——
 *    那里画布放的是 Builder 出的真实 HTML, 大才有用。
 */

const scenes = [
  { id: 's1', startMs: 0, endMs: 3000, label: '第一幕', claim: '第一幕', layout: 'content-full' as const, previewHtml: '' },
  { id: 's2', startMs: 3000, endMs: 6000, label: '第二幕', claim: '第二幕', layout: 'person-full' as const, previewHtml: '' },
];
const captionStyle = {
  on: false, fontSize: 56, marginV: 90,
  primaryColor: '#FFFFFF', outlineColor: '#000000', outlineWidth: 3,
};

function renderEditor(canvasMaxHeightPx?: number) {
  const { container } = render(
    <TimelineEditor
      scenes={scenes}
      captions={[]}
      frame={{ width: 1080, height: 1920 }}
      onLayoutChange={() => {}}
      onSelect={() => {}}
      captionStyle={captionStyle}
      canvasMaxHeightPx={canvasMaxHeightPx}
    />,
  );
  const canvas = container.querySelector<HTMLElement>('[style*="aspect-ratio"]');
  if (!canvas) throw new Error('找不到画布');
  return { container, canvas };
}

afterEach(cleanup);

describe('TimelineEditor 画布尺寸', () => {
  it('给了 canvasMaxHeightPx → 落成**确定的 height**, 宽度让给 aspectRatio 反推', () => {
    const { canvas } = renderEditor(220);
    // 只给 maxHeight 会让两个方向都没有确定值, 画布塌成 2x4(真机踩过)
    expect(canvas.style.height).toBe('220px');
    expect(canvas.style.width).toBe('auto');
    expect(canvas.style.aspectRatio).toBe('1080 / 1920');
  });

  it('不给 → 保持老行为(只按宽度约束), 试做台不受影响', () => {
    const { canvas } = renderEditor(undefined);
    expect(canvas.style.height).toBe('');
    expect(canvas.style.width).toBe('');
    expect(canvas.className).toContain('max-w-md');
  });

  it('画布与「这一幕的版面」在同一个横向区里 —— 选版面时要盯着画布看框在哪', () => {
    const { canvas } = renderEditor(220);
    const zone = canvas.parentElement;
    expect(zone?.className).toContain('md:flex-row');
    expect(zone?.textContent).toContain('这一幕的版面');
    // 时间线不在这个区里: 它要整宽, 挤进窄栏时场景块每块只剩一个字(真机量过)
    expect(zone?.textContent).not.toContain('按住拖动时间线');
  });

  it('五种版面都给得出来, 结构改动没有弄丢按钮', () => {
    renderEditor(220);
    for (const label of ['人物全屏', '内容全屏', '左内容·右人物', '左人物·右内容', '内容铺满·圆形人物']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });
});
