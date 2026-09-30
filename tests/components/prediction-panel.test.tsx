// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PredictionPanel } from '@/components/project/prediction-panel';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const scores = [
  { dim: 'hook', score: 2, reason: '开头在铺垫', quote: '大家好', segmentId: 's1', fix: '第一句直接说结果' },
  { dim: 'pace', score: 3, reason: '平稳', quote: '', segmentId: null, fix: '' },
  { dim: 'ending', score: 4, reason: '有回收', quote: '', segmentId: null, fix: '' },
  { dim: 'interaction', score: 3, reason: '一般', quote: '', segmentId: null, fix: '' },
  { dim: 'topic', score: 3, reason: '常规', quote: '', segmentId: null, fix: '' },
];
const result = computePrediction({ scores: { hook: 2, pace: 3, ending: 4, interaction: 3, topic: 3 }, baselines: { hook2s: 0.4 }, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
const view = { id: 'pr1', kind: 'draft', createdAt: '2026-09-30T00:00:00.000Z', formulaVersion: 1, scores, result, check: null };
const data = (over = {}) => ({ latest: view, final: null, recorded: null, running: false, published: false, canLockFinal: false, canLockRecorded: false, ...over });

describe('PredictionPanel', () => {
  it('shows scores, buckets, confidence and drag items, and hands fixes to the editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data() }) })));
    const onHighlight = vi.fn();
    const onAskEditor = vi.fn();
    render(<PredictionPanel projectId="p1" onHighlight={onHighlight} onAskEditor={onAskEditor} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/开头钩子 2 分/)).toBeTruthy());
    expect(screen.getByText(/中枢约/)).toBeTruthy();
    expect(screen.getByText(/置信度低/)).toBeTruthy();
    fireEvent.click(screen.getByText('「大家好」'));
    expect(onHighlight).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getAllByText('让编导按这个改')[0]);
    expect(onAskEditor).toHaveBeenCalledWith('按预测的建议改「开头钩子」：第一句直接说结果');
  });
  it('starts a draft prediction and disables the button while running', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'POST' ? { jobId: 'j1' } : data({ latest: null }) }) }));
    vi.stubGlobal('fetch', f);
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('预测')).toBeTruthy());
    fireEvent.click(screen.getByText('预测'));
    await waitFor(() => expect(f.mock.calls.some((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(String((f.mock.calls.find((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST') as unknown as [string, RequestInit])[1].body))).toEqual({ kind: 'draft' });
  });
  it('explains why there are no numbers and offers to lock missing predictions', async () => {
    const none = { ...view, result: computePrediction({ scores: { hook: 2, pace: 3, ending: 4, interaction: 3, topic: 3 }, baselines: {}, baselineViews: null, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS }) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data({ latest: none, canLockFinal: true }) }) })));
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/公开作品少于 3 条/)).toBeTruthy());
    expect(screen.getByText('补做定稿预测')).toBeTruthy();
  });
  it('hides the button once published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data({ published: true }) }) })));
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/已发布，不再预测/)).toBeTruthy());
    expect(screen.queryByText('预测')).toBeNull();
  });
  it('reloads when the workspace says predictions may have changed', async () => {
    const f = vi.fn(async () => ({ json: async () => ({ success: true, data: data() }) }));
    vi.stubGlobal('fetch', f);
    const { rerender } = render(<PredictionPanel projectId="p1" reloadKey="a" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    rerender(<PredictionPanel projectId="p1" reloadKey="b" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });
  it('shows quotes without a segment as plain text', async () => {
    const plain = { ...view, kind: 'recorded', scores: scores.map((s) => (s.dim === 'hook' ? { ...s, segmentId: null } : s)) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data({ latest: plain }) }) })));
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('「大家好」')).toBeTruthy());
    expect(screen.getByText('「大家好」').tagName).not.toBe('BUTTON');
  });
});
