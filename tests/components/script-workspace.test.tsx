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

  it('素材库为空时明说「AI 就会开始编」, 不假装有内容', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { materials: [] } }) } as Response);
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: '素材' }));
    await waitFor(() => expect(screen.getByText(/AI 就会开始编/)).toBeTruthy());
  });

  it('这一幕匹配不到素材时明说匹配不到, **不退回展示最近几条** —— 无关素材会诱导人写进稿子', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { materials: [{ id: 'm1', kind: 'quote', content: '量子力学入门', source: '', tags: [] }] },
      }),
    } as Response);
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: '素材' }));
    await waitFor(() => expect(screen.getByText(/一条都没匹配上/)).toBeTruthy());
    expect(screen.queryByText('量子力学入门')).toBeNull();
  });

  it('没有 AI 原版记录时明说, 不假装能比较', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: '改写' }));
    expect(screen.getByText(/没有 AI 原版记录/)).toBeTruthy();
  });

  it('有原版时报改写度, 并**点名一个字没改的幕**', () => {
    const baseline = ACTS.map((a) => ({ ...a }));
    render(
      <ScriptWorkspace
        scriptId="d2"
        topic="测试稿"
        platform="douyin"
        durationSec={60}
        initialActs={ACTS.map((a) =>
          a.act === 'hook' ? { ...a, narration: '完全换一种说法来开这个头' } : { ...a },
        )}
        softScore={null}
        softMax={65}
        softDimensions={[]}
        aiBaselineActs={baseline}
      />,
    );
    fireEvent.click(screen.getAllByRole('tab', { name: '改写' })[0]);
    // 只改了 hook, 其余五幕一个字没动
    expect(screen.getAllByText('一个字没改').length).toBe(5);
  });

  it('改写度随打字实时变 —— 它是纯函数, 不等保存', async () => {
    const baseline = ACTS.map((a) => ({ ...a }));
    render(
      <ScriptWorkspace
        scriptId="d3" topic="t" platform="douyin" durationSec={60}
        initialActs={ACTS.map((a) => ({ ...a }))}
        softScore={null} softMax={65} softDimensions={[]}
        aiBaselineActs={baseline}
      />,
    );
    fireEvent.click(screen.getAllByRole('tab', { name: '改写' })[0]);
    expect(screen.getAllByText('一个字没改').length).toBe(6);

    fireEvent.click(screen.getAllByRole('tab', { name: '评分' })[0]);
    fireEvent.change(screen.getByDisplayValue('hook 台词'), {
      target: { value: '换成完全不一样的一句开场白' },
    });
    fireEvent.click(screen.getAllByRole('tab', { name: '改写' })[0]);
    await waitFor(() => expect(screen.getAllByText('一个字没改').length).toBe(5));
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

describe('骨架稿(台词全空)', () => {
  const BLANK = ACTS.map((a) => ({ ...a, narration: '' }));

  function renderBlank() {
    return render(
      <ScriptWorkspace
        scriptId="d2"
        topic="骨架稿"
        platform="douyin"
        durationSec={60}
        initialActs={BLANK}
        softScore={null}
        softMax={65}
        softDimensions={[]}
      />,
    );
  }

  it('**不给分数** —— 空稿子在时长、简洁度上天生满分, 那个数字会教错东西', () => {
    renderBlank();
    expect(screen.getAllByText('还没开始写').length).toBeGreaterThan(0);
    expect(screen.queryByText('总分')).toBeNull();
  });

  it('说清楚台词是留给你的, 备注写着这一幕该干什么', () => {
    renderBlank();
    expect(screen.getByText(/台词是空的——那是留给你的/)).toBeTruthy();
  });

  it('写下第一句就开始算分 —— 不等你写完', async () => {
    renderBlank();
    // 六幕台词都是空串, 靠 hook 幕的画面框定位到当前幕, 再取它上面的旁白框
    const boxes = document.querySelectorAll('textarea');
    fireEvent.change(boxes[0], { target: { value: '你有没有过这种时候' } });
    await waitFor(() => expect(screen.queryByText('还没开始写')).toBeNull());
  });
});
