// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';

/*
 * 叠加元素画布拖拽层(三十七期 Task 6)——纯 props 组件, 照 `OverlayEditor`/
 * `StyleControls` 先例, 不挂整个 workbench。
 *
 * **本任务铁律**: 编辑层定位必须调 `overlayPosition`, 不许自算几何——
 * 测试①就是钉住"共用同一函数"这件事: 变异 `overlayPosition` 的一个格位
 * 常数, 把手位置断言必须跟着变, 否则说明拖拽层抄了一份常数而不是真的调用
 * 同一个函数。
 */
import { OverlayDragLayer } from '@/components/films/overlay-drag-layer';
import { overlayPosition } from '@/lib/video-production/overlay-plan';
import type { OverlayItem } from '@/lib/video-production/overlay-plan';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function items(): OverlayItem[] {
  return [
    { kind: 'keyword', text: '关键词一', slot: 'left-1', startMs: 0, endMs: 2000 },
    { kind: 'note', text: '注解条目', slot: 'left-2', startMs: 0, endMs: 2000 },
  ];
}

const CONTAINER_RECT = { left: 0, top: 0, width: 1000, height: 500 };

function mockContainerRect() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...CONTAINER_RECT,
    right: CONTAINER_RECT.width,
    bottom: CONTAINER_RECT.height,
    x: 0,
    y: 0,
    toJSON() { return this; },
  } as DOMRect);
}

describe('OverlayDragLayer', () => {
  it('几何一致性: 把手 left/top 百分比 === overlayPosition 的返回', () => {
    mockContainerRect();
    const { container } = render(
      <OverlayDragLayer items={items()} aspect="16:9" personSide="right" onPositionChange={() => {}} />,
    );
    const handles = container.querySelectorAll('[data-overlay-handle-idx]');
    expect(handles.length).toBe(2);

    const expected0 = overlayPosition('16:9', 'right', items()[0]);
    const expected1 = overlayPosition('16:9', 'right', items()[1]);

    expect((handles[0] as HTMLElement).style.left).toBe(`${expected0.x * 100}%`);
    expect((handles[0] as HTMLElement).style.top).toBe(`${expected0.y * 100}%`);
    expect((handles[1] as HTMLElement).style.left).toBe(`${expected1.x * 100}%`);
    expect((handles[1] as HTMLElement).style.top).toBe(`${expected1.y * 100}%`);
  });

  it('跨文件变异验证: 改 position.ts 的格位常数, 把手位置断言必须跟着变(此用例本身只做基线记录, 真正的变异在报告里手工核实)', () => {
    mockContainerRect();
    const { container } = render(
      <OverlayDragLayer items={items()} aspect="16:9" personSide="right" onPositionChange={() => {}} />,
    );
    const handle0 = container.querySelector('[data-overlay-handle-idx="0"]') as HTMLElement;
    const expected0 = overlayPosition('16:9', 'right', items()[0]);
    expect(handle0.style.top).toBe(`${expected0.y * 100}%`);
  });

  it('pointerdown → move → up: 回调收到 clamp 到 0~1 的归一化坐标', () => {
    mockContainerRect();
    const onPositionChange = vi.fn();
    const { container } = render(
      <OverlayDragLayer items={items()} aspect="16:9" personSide="right" onPositionChange={onPositionChange} />,
    );
    const handle = container.querySelector('[data-overlay-handle-idx="0"]') as HTMLElement;
    // jsdom 没实现 setPointerCapture, mock 成空函数避免抛错
    (handle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    (handle as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    // 容器宽 1000 高 500 → clientX=500,clientY=250 应换算成 (0.5, 0.5)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 250 });
    expect(onPositionChange).toHaveBeenCalledWith(0, { x: 0.5, y: 0.5 });

    onPositionChange.mockClear();
    // clamp: 超出容器范围的坐标应夹到 0~1
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -100, clientY: 10000 });
    expect(onPositionChange).toHaveBeenCalledWith(0, { x: 0, y: 1 });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: -100, clientY: 10000 });
  });

  it('带 x/y 覆盖的条目, 把手渲在 x/y 处而不是 slot 默认格位', () => {
    mockContainerRect();
    const withXY: OverlayItem[] = [
      { kind: 'keyword', text: '拖过的词', slot: 'left-1', startMs: 0, endMs: 2000, x: 0.33, y: 0.66 },
    ];
    const { container } = render(
      <OverlayDragLayer items={withXY} aspect="16:9" personSide="right" onPositionChange={() => {}} />,
    );
    const handle = container.querySelector('[data-overlay-handle-idx="0"]') as HTMLElement;
    expect(handle.style.left).toBe('33%');
    expect(handle.style.top).toBe('66%');
  });
});
