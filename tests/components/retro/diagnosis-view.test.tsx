// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DiagnosisView } from '@/components/retro/diagnosis-view';
import type { Diagnosis } from '@/lib/retro/diagnose';

afterEach(cleanup);

const d: Diagnosis = {
  stages: [
    { key: 'hook2s', label: '开头 2 秒（跳出率）', value: 0.2, baseline: 0.3, verdict: 'good', note: '20.0%；平时 30.0%' },
    { key: 'middle', label: '中段（平均观看）', value: 8.2, baseline: 10, verdict: 'bad', note: '平均在第 8 秒离开，这时在讲「概念A」：『背景铺垫很长』；平时 10.0 秒' },
  ],
  baselineCount: 4,
  dropAt: { sec: 8.2, segment: '概念A', line: '背景铺垫很长' },
  benchmark: { theirRatio: 8.6, myRatio: 1.2 },
  curve: [{ day: '2026-09-30', viewCount: 500, likeCount: 10 }, { day: '2026-10-01', viewCount: 900, likeCount: 18 }],
};

describe('DiagnosisView', () => {
  it('shows each stage with its verdict and note', () => {
    render(<DiagnosisView diagnosis={d} />);
    expect(screen.getByText('开头 2 秒（跳出率）')).toBeTruthy();
    expect(screen.getByText('比平时好')).toBeTruthy();
    expect(screen.getByText('比平时差')).toBeTruthy();
    expect(screen.getByText(/这时在讲「概念A」/)).toBeTruthy();
  });
  it('shows the benchmark comparison and the curve', () => {
    render(<DiagnosisView diagnosis={d} />);
    expect(screen.getByText('对标这条是他平时的 8.6 倍，你这条是你平时的 1.2 倍')).toBeTruthy();
    expect(screen.getByText('第 2 天')).toBeTruthy();
  });
});
