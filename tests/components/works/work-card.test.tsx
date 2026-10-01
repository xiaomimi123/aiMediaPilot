// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkCard } from '@/components/works/work-card';
import { stepsOf } from '@/lib/overview/steps';

afterEach(cleanup);
const base = { stage: 'final', hasBenchmark: true, hasScript: true, published: false, hasRetro: false };

describe('WorkCard', () => {
  it('shows the prediction before publishing and views after', () => {
    const card = { id: 'p1', title: 'U盘干到品类第一', stage: 'final', steps: stepsOf(base), durationSec: 65, center: 4565, views: null, updatedAt: '2026-09-29T00:00:00.000Z' };
    const { rerender } = render(<WorkCard card={card} />);
    expect(screen.getByText('预测 ~4,565')).toBeTruthy();
    expect(screen.getByText('成片 · 下一步：发布并关联作品')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects/p1');
    rerender(<WorkCard card={{ ...card, steps: stepsOf({ ...base, published: true }), views: 25152 }} />);
    expect(screen.getByText('播放 2.5万')).toBeTruthy();
  });
});
