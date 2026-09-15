// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PlanList } from '@/components/plan/plan-list';

afterEach(() => cleanup());

const pillars = [{ name: '工具评测' }, { name: '避坑' }];

const days = [
  { dayIndex: 1, date: '2026-09-10', pillarName: '工具评测', topic: '选题1', status: 'produced' as const },
  { dayIndex: 2, date: '2026-09-11', pillarName: '工具评测', topic: '选题2', status: 'pending' as const },
  { dayIndex: 3, date: '2026-09-12', pillarName: '工具评测', topic: '选题3', status: 'pending' as const },
];

describe('PlanList', () => {
  it('渲染每天的日期/支柱/选题/状态徽章', () => {
    render(<PlanList days={days} todayIndex={3} pillars={pillars} />);
    expect(screen.getByText('选题1')).toBeTruthy();
    expect(screen.getByText('2026-09-10')).toBeTruthy();
    expect(screen.getByText('已出片')).toBeTruthy();
  });

  it('今天那一行有高亮标记', () => {
    render(<PlanList days={days} todayIndex={3} pillars={pillars} />);
    const todayRow = screen.getByText('选题3').closest('li')!;
    expect(todayRow.getAttribute('data-today')).toBe('true');
    const otherRow = screen.getByText('选题1').closest('li')!;
    expect(otherRow.getAttribute('data-today')).toBeNull();
  });

  it('已过去且仍 pending 的天灰化标「已过」', () => {
    render(<PlanList days={days} todayIndex={3} pillars={pillars} />);
    // day 2 是过去且 pending → 已过
    const day2Row = screen.getByText('选题2').closest('li')!;
    expect(day2Row.textContent).toContain('已过');
    // day 3 是今天且 pending → 不该标已过, 应显示"待写"
    const day3Row = screen.getByText('选题3').closest('li')!;
    expect(day3Row.textContent).not.toContain('已过');
    expect(day3Row.textContent).toContain('待写');
  });

  it('支柱覆盖警告非空时顶部展示', () => {
    const onePillarDays = days.map((d) => ({ ...d, pillarName: '工具评测' }));
    render(<PlanList days={onePillarDays} todayIndex={3} pillars={pillars} />);
    expect(screen.getByText(/避坑.*一次都没出现/)).toBeTruthy();
  });

  it('全覆盖时没有警告', () => {
    const covered = [
      { dayIndex: 1, date: '2026-09-10', pillarName: '工具评测', topic: '选题1', status: 'pending' as const },
      { dayIndex: 2, date: '2026-09-11', pillarName: '避坑', topic: '选题2', status: 'pending' as const },
    ];
    render(<PlanList days={covered} todayIndex={1} pillars={pillars} />);
    expect(screen.queryByText(/一次都没出现/)).toBeNull();
  });
});

describe('PlanList - 出片失败的诚实展示', () => {
  /*
   * 2026-09-15 真实场景: 第 1 天规划里标「已出片」(绿), 但那条片渲染失败了 ——
   * 规划页在替一条不存在的成片庆祝。produced 天带 filmFailed 时改标「出片失败」。
   */
  it('produced 但成片失败 → 徽章是「出片失败」而不是「已出片」', () => {
    const withFailed = [{ ...days[0], filmFailed: true }, days[1], days[2]];
    render(<PlanList days={withFailed} todayIndex={3} pillars={pillars} />);
    expect(screen.getByText('出片失败')).toBeTruthy();
    expect(screen.queryByText('已出片')).toBeNull();
  });
});
