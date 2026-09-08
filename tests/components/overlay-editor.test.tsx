// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

/*
 * 剪辑台「文字叠加」编辑区(三十七期 Task 5)——纯 props 进 props 出组件, 照
 * `workbench-follow-template.test.tsx` 先例(`StyleControls`), 不需要挂整个
 * `FilmPlanWorkbench`。
 */
import { OverlayEditor } from '@/components/films/overlay-editor';
import type { OverlayItem } from '@/lib/video-production/overlay-plan';

afterEach(() => {
  cleanup();
});

function items(n: number): OverlayItem[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'keyword' as const,
    text: `词${i}`,
    slot: 'left-1' as const,
    startMs: i * 1000,
    endMs: i * 1000 + 2000,
  }));
}

describe('OverlayEditor', () => {
  it('渲染 N 条', () => {
    render(<OverlayEditor items={items(3)} onChange={() => {}} />);
    expect(screen.getAllByDisplayValue(/^词/).length).toBe(3);
  });

  it('改 text → onChange 收到更新后的 items', () => {
    const onChange = vi.fn();
    render(<OverlayEditor items={items(1)} onChange={onChange} />);
    const input = screen.getByDisplayValue('词0');
    fireEvent.change(input, { target: { value: '新词' } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: '新词' }),
    ]);
  });

  it('删一条 → onChange 收到去掉该条的数组', () => {
    const onChange = vi.fn();
    render(<OverlayEditor items={items(2)} onChange={onChange} />);
    const delButtons = screen.getAllByRole('button', { name: '删' });
    fireEvent.click(delButtons[0]);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: '词1' }),
    ]);
  });

  it('加一条 → onChange 收到追加的默认 keyword 条目', () => {
    const onChange = vi.fn();
    render(<OverlayEditor items={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '加一条' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'keyword', text: '', slot: 'left-1', startMs: 0, endMs: 3000 },
    ]);
  });

  it('带 x/y 的条目行尾显示「已拖动」+「恢复格位」, 点击后回调删掉 x/y', () => {
    const onChange = vi.fn();
    const withXY: OverlayItem[] = [
      { kind: 'keyword', text: '拖过', slot: 'left-2', startMs: 0, endMs: 2000, x: 0.3, y: 0.4 },
    ];
    render(<OverlayEditor items={withXY} onChange={onChange} />);
    expect(screen.getByText('已拖动')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复格位' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'keyword', text: '拖过', slot: 'left-2', startMs: 0, endMs: 2000 },
    ]);
  });

  it('不带 x/y 的条目不出现「已拖动」/「恢复格位」', () => {
    render(<OverlayEditor items={items(1)} onChange={() => {}} />);
    expect(screen.queryByText('已拖动')).toBeNull();
    expect(screen.queryByRole('button', { name: '恢复格位' })).toBeNull();
  });

  it('kind 切到 arrow → text 输入被禁用且清空', () => {
    const onChange = vi.fn();
    render(<OverlayEditor items={items(1)} onChange={onChange} />);
    const select = screen.getByDisplayValue('关键词');
    fireEvent.change(select, { target: { value: 'arrow' } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'arrow', text: '' }),
    ]);
  });
});
