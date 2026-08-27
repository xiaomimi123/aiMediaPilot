// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ScriptWorkspace } from '@/components/script/workspace';
import { ACT_KEYS } from '@/lib/script/six-act';

const ACTS = ACT_KEYS.map((act) => ({
  act,
  title: `${act} 标题`,
  narration: `${act} 台词`,
  visual: `${act} 画面`,
  note: `${act} 备注`,
  targetSec: 10,
  beats: [{ keyword: `${act}-kw` }],
  facts:
    act === 'hook'
      ? [{ claim: '销量', value: '六千多单', source: '本人后台', confidence: 'low' as const }]
      : [],
}));

function renderWorkspace() {
  return render(
    <ScriptWorkspace
      scriptId="d1"
      topic="测试稿"
      platform="douyin"
      durationSec={60}
      initialActs={ACTS}
      softScore={null}
      softMax={65}
      softDimensions={[]}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.fn(async (_u: string, _o?: RequestInit) => ({ ok: true }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ScriptWorkspace', () => {
  it('六幕全部常驻顶部时长分配条, 不藏进 tab', () => {
    renderWorkspace();
    expect(screen.getByText('时长分配')).toBeTruthy();
    for (const label of ['概念A', '概念B', '冷知识', '知识串联', '金句收尾']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 当前幕的名字会同时出现在时长条和编辑区标题上
    expect(screen.getAllByText('开场钩子').length).toBeGreaterThanOrEqual(2);
  });

  it('旁白框实时显示字数与预计秒数 —— 打字时就知道这一幕撑不撑得下', () => {
    renderWorkspace();
    expect(screen.getByText(/\d+ 字 · \d+\.\d+s/)).toBeTruthy();
  });

  it('右栏三个 tab; 素材与变体如实说明还没做, 不假装有内容', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: '素材' }));
    expect(screen.getByText(/素材库还没建/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '变体' }));
    expect(screen.getByText(/变体还没做/)).toBeTruthy();
  });

  it('待处理把扣分翻译成去改哪一幕 —— 只给分不给去处等于没评', () => {
    renderWorkspace();
    expect(screen.getByText('待处理')).toBeTruthy();
    expect(screen.getByText(/低置信事实待核：销量/)).toBeTruthy();
  });

  it('低可信度的事实核查直接摆出来, 并显示来源', () => {
    renderWorkspace();
    expect(screen.getByText('存疑')).toBeTruthy();
    expect(screen.getByText(/来源：本人后台/)).toBeTruthy();
  });

  it('没跑软指标时显示「未评分」, 不显示 0 分', () => {
    renderWorkspace();
    expect(screen.getByText('未评分')).toBeTruthy();
    expect(screen.queryByText('0/65')).toBeNull();
  });

  it('底部不提供发起出片的入口 —— 链路没稳定之前不做界面', () => {
    renderWorkspace();
    expect(screen.queryByText(/出片|生成成片|开始制作/)).toBeNull();
    expect(screen.getByText('提词器')).toBeTruthy();
  });

  it('改台词后自动保存, 且**完整带上 beats/facts/note** —— 少一个字段就会被后端拒绝', async () => {
    renderWorkspace();
    const textarea = screen.getByDisplayValue('hook 台词');
    fireEvent.change(textarea, { target: { value: '改过的台词' } });

    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/scripts/d1/acts');
    expect(opts.method).toBe('PUT');
    const sent = JSON.parse(String(opts.body)).acts;
    expect(sent).toHaveLength(6);
    const hook = sent.find((a: { act: string }) => a.act === 'hook');
    expect(hook.narration).toBe('改过的台词');
    expect(hook.beats).toEqual([{ keyword: 'hook-kw' }]);
    expect(hook.facts).toHaveLength(1);
    expect(hook.note).toBe('hook 备注');
  });

  it('刚打开还没改动时不发保存请求', async () => {
    renderWorkspace();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('保存失败时明确告诉用户改动还在页面上', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    renderWorkspace();
    fireEvent.change(screen.getByDisplayValue('hook 台词'), { target: { value: 'x' } });
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('别关');
  });

  it('硬指标随改动就地重算 —— 加入垫话后分数要掉', async () => {
    renderWorkspace();
    // 「硬指标」在页眉总分卡和右栏各出现一次, 这里只看右栏那个标题
    const panelScore = () =>
      screen.getAllByText(/^硬指标/).map((e) => e.closest('h2')).find(Boolean)!.textContent;
    const before = panelScore();
    fireEvent.change(screen.getByDisplayValue('hook 台词'), {
      target: { value: '说实话其实这个东西居然还不错' },
    });
    await waitFor(() => expect(panelScore()).not.toBe(before));
  });
});
