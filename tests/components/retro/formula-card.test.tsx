// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormulaCard } from '@/components/retro/formula-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormulaCard', () => {
  it('shows a proposal with its backtest and adopts it', async () => {
    const f = vi.fn(async (url: string) => ({
      json: async () => ({ success: true, data: url === '/api/predict/formulas' ? { active: { version: 1 }, proposed: { version: 2, reason: { label: '播放量', direction: 'optimistic', samples: 3, oldError: Math.log(2.1), newError: Math.log(1.6) } } } : { version: 2 } }),
    }));
    vi.stubGlobal('fetch', f);
    const onChanged = vi.fn();
    render(<FormulaCard onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText(/播放量连续偏乐观/)).toBeTruthy());
    expect(screen.getByText(/平均误差 2.1 倍 → 1.6 倍/)).toBeTruthy();
    fireEvent.click(screen.getByText('采纳'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(f.mock.calls.map((c) => (c as unknown as [string])[0])).toContain('/api/predict/formulas/2');
  });
  it('renders nothing without a proposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { active: { version: 1 }, proposed: null } }) })));
    const { container } = render(<FormulaCard onChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
