// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * 雷达条目的采纳(三十四期补)。
 *
 * 背景: 后端 PATCH /api/v1/radar/items/:id (adopt/ignore, 带事务与幂等守卫)
 * 四期就建好了, 但前端的雷达 tab 只做了「展开看详情」—— 采纳按钮从来没渲染过。
 * 用户想把雷达文章收进灵感库创作, 界面上无路可走。热搜 tab 有按钮, 雷达没有,
 * 两栏并排摆着, 缺口反而更显眼。
 */
const fetchMock = vi.hoisted(() => vi.fn());

import { TopicTabs } from '@/components/topics/topic-tabs';

const RADAR = [
  {
    id: 'r1',
    title: 'AI Model Captures How Humans Read',
    url: 'https://example.com/a',
    source: 'example.com',
    heat: 100,
    angle: 'AI 终于读懂你怎么读东西',
    summary: '一句摘要',
    collectedAt: '2026-09-07',
  },
  {
    id: 'r2',
    title: 'Another News',
    url: 'https://example.com/b',
    source: 'example.com',
    heat: 80,
    angle: '第二条角度',
    summary: '',
    collectedAt: '2026-09-07',
  },
];

function renderRadarTab() {
  render(
    <TopicTabs
      radar={RADAR}
      radarTotal={175}
      adoptedCount={3}
      inspirations={[]}
      hot={[]}
    />,
  );
  fireEvent.click(screen.getByText(/热点雷达/));
}

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { status: 'adopted' } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('雷达条目采纳', () => {
  it('每条雷达条目都有「存进灵感库」与「忽略」两个动作', () => {
    renderRadarTab();
    expect(screen.getAllByText('存进灵感库')).toHaveLength(2);
    expect(screen.getAllByText('忽略')).toHaveLength(2);
  });

  it('点「存进灵感库」调 PATCH adopt, 成功后该条从列表消失', async () => {
    renderRadarTab();
    fireEvent.click(screen.getAllByText('存进灵感库')[0]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/radar/items/r1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'adopt' }),
        }),
      );
    });
    // 列表默认只显示待处理(status=new), 采纳成功后这一条就不属于这个列表了
    await waitFor(() => {
      expect(screen.queryByText('AI 终于读懂你怎么读东西')).toBeNull();
    });
    expect(screen.getByText('第二条角度')).toBeTruthy();
  });

  it('点「忽略」调 PATCH ignore, 成功后该条同样消失', async () => {
    renderRadarTab();
    fireEvent.click(screen.getAllByText('忽略')[1]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/radar/items/r2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'ignore' }) }),
      );
    });
    await waitFor(() => expect(screen.queryByText('第二条角度')).toBeNull());
  });

  it('采纳成功后, 灵感库 tab 立刻能看到这一条 —— 不用刷新页面', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { inspirationId: 'insp-new' } }),
    });
    renderRadarTab();
    fireEvent.click(screen.getAllByText('存进灵感库')[0]);
    await waitFor(() => expect(screen.queryByText('AI 终于读懂你怎么读东西')).toBeNull());
    // 「/灵感库/」会同时命中每行的「存进灵感库」按钮 —— 锚定行首只取 tab 标签
    fireEvent.click(screen.getByText(/^灵感库/));
    expect(screen.getByText(/AI Model Captures How Humans Read/)).toBeTruthy();
  });

  it('请求失败时条目留在原地 —— 静默吞掉失败会让人以为存进去了', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) });
    renderRadarTab();
    fireEvent.click(screen.getAllByText('存进灵感库')[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText('AI 终于读懂你怎么读东西')).toBeTruthy();
  });
});
