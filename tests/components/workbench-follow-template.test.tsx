// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

/*
 * 剪辑台样式面板「跟随模板」三态(三十六期 Task 5)——照 `plan-preview.test.tsx`
 * 先例, `StyleControls` 是纯 props 进 props 出的组件, 不需要挂整个
 * `FilmPlanWorkbench`(那需要 mock GET/PUT 一整套)。`StyleControls` 本身未导出,
 * 这里先导出它(理由同三十三期 Task 4.5: 能被单测看见的东西才有人在改坏后发现)。
 */
import { StyleControls } from '@/components/films/film-plan-workbench';

afterEach(() => {
  cleanup();
});

const baseShot = {
  shotId: 's1', startMs: 0, endMs: 3000, card: 'statement' as const,
  slots: { text: '开场', sub: '' },
};

describe('StyleControls: 跟随模板三态', () => {
  it('未覆盖 + 模板设了该字段 → label 带「跟随模板」, 显示值来自 mergeShotStyle', () => {
    render(
      <StyleControls
        shot={{ ...baseShot, style: undefined }}
        templateStyle={{ accent: 'red' }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    // 强调色控件的 label 里带「跟随模板」字样
    expect(screen.getByText('强调色 · 跟随模板')).toBeTruthy();
    // select 当前值 = mergeShotStyle({accent:'red'}, {})的结果 = 'red'
    const select = screen.getByLabelText(/强调色/) as HTMLSelectElement;
    expect(select.value).toBe('red');
  });

  it('已覆盖 → 显示「已覆盖」态(恢复按钮可点), 显示值为镜上的值', () => {
    render(
      <StyleControls
        shot={{ ...baseShot, style: { accent: 'blue' } }}
        templateStyle={{ accent: 'red' }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    const select = screen.getByLabelText(/强调色/) as HTMLSelectElement;
    expect(select.value).toBe('blue');
    // 已覆盖时不再带「跟随模板」后缀
    expect(screen.queryByText('强调色 · 跟随模板')).toBeNull();
    const resetBtn = screen.getByRole('button', { name: '恢复跟随' });
    expect(resetBtn.hasAttribute('disabled')).toBe(false);
  });

  it('点「恢复跟随」→ onReset(key) 被调', () => {
    const onReset = vi.fn();
    render(
      <StyleControls
        shot={{ ...baseShot, style: { accent: 'blue' } }}
        templateStyle={{ accent: 'red' }}
        onChange={() => {}}
        onReset={onReset}
      />,
    );
    // 三个控件里只有 accent 被模板设置且被覆盖, 唯一一个「恢复跟随」按钮就是它。
    fireEvent.click(screen.getByRole('button', { name: '恢复跟随' }));
    expect(onReset).toHaveBeenCalledWith('accent');
  });

  it('模板没设该字段 → 未覆盖时按钮文案仍是「恢复默认」', () => {
    render(
      <StyleControls
        shot={{ ...baseShot, style: undefined }}
        templateStyle={null}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getAllByRole('button', { name: '恢复默认' }).length).toBe(3);
    expect(screen.queryByText(/跟随模板/)).toBeNull();
  });
});
