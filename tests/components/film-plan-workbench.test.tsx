// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * 剪辑台(三十一期 Task 4)组件测试——照 `film-detail-renderer-switch.test.tsx` 先例
 * 用 React Testing Library。挂载条件(`status === 'plan_ready'`)在 `film-detail.test`
 * 系列里已经有先例风格, 这里只测 `FilmPlanWorkbench` 自身(它自己拉 GET, 不吃
 * `FilmDetail` 的 props), 以及在 `FilmDetail` 里按状态出现/不出现。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { FilmDetail } from '@/components/films/film-detail';
import { FilmPlanWorkbench } from '@/components/films/film-plan-workbench';

const baseFilm = {
  id: 'f1', title: '测试片', mode: 'ppt-narration', status: 'plan_ready',
  createdAt: '2026-09-03', errorMessage: null, hasPreview: false, hasMaster: false,
  templateName: '图文口播', scriptDraftId: null, publishedUrl: null,
  scenes: [], captions: [], savedLayouts: {}, brollEnabled: true,
  frame: { width: 1920, height: 1080 }, freezeReport: null, renderer: 'remotion', productionNotice: null,
};

const filmPlanGetBody = {
  success: true,
  data: {
    id: 'f1',
    filmPlan: {
      shots: [
        {
          shotId: 's1', startMs: 0, endMs: 3000, card: 'statement',
          slots: { text: '开场', sub: '' },
        },
        {
          shotId: 's2', startMs: 3000, endMs: 6000, card: 'stat',
          slots: { label: '销量', value: 82, prefix: '', suffix: '%', note: '' },
        },
      ],
    },
    alignedActs: [],
    mode: 'ppt-narration',
    visualStyle: 'card',
    aspect: '16:9',
    totalMs: 6000,
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchSequence(handlers: Array<(url: string, init?: RequestInit) => unknown>) {
  let i = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    const body = handler(url, init);
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('剪辑台挂载条件（film-detail.tsx）', () => {
  beforeEach(() => {
    mockFetchSequence([() => filmPlanGetBody]);
  });

  it('status === plan_ready 时出现剪辑台', async () => {
    render(<FilmDetail initial={baseFilm} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
  });

  it('其它状态（如 preview_ready）不出现剪辑台', () => {
    render(<FilmDetail initial={{ ...baseFilm, status: 'preview_ready', hasPreview: true }} />);
    expect(screen.queryByTestId('film-plan-workbench')).toBeNull();
  });
});

describe('FilmPlanWorkbench', () => {
  beforeEach(() => {
    mockFetchSequence([() => filmPlanGetBody]);
  });

  it('加载完成后展示缩略图条与镜号/卡类型/时长', async () => {
    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
    expect(screen.getByText('1 · 陈述')).not.toBeNull();
    expect(screen.getByText('2 · 数据')).not.toBeNull();
    expect(screen.getAllByText('3.0s').length).toBeGreaterThan(0);
  });

  it('换卡时若原槽位有内容会弹确认', async () => {
    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
    // 第 1 镜(statement, text='开场')默认选中——换成"数据"应该弹确认
    const select = screen.getByLabelText('卡类型') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'stat' } });
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('换卡会清空这一镜已经填写的内容') ?? false).length)
      .toBeGreaterThan(0);
    // 取消不应该真的换卡——原字段还在
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryAllByText((_, el) => el?.textContent?.includes('换卡会清空这一镜已经填写的内容') ?? false).length)
      .toBe(0);
  });

  it('字数超限即时红字', async () => {
    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
    const textInput = screen.getByDisplayValue('开场') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: '一'.repeat(30) } });
    expect(screen.getByText('30/24')).not.toBeNull();
    expect(textInput.className).toContain('border-destructive');
  });

  it('保存调用 PUT，400 时展示 errors（含英文 zod 文案的转译）', async () => {
    mockFetchSequence([
      () => filmPlanGetBody,
      () => ({
        success: false,
        message: '分镜方案格式不对',
        errors: ['shots.0.slots.value: Expected number, received string'],
      }),
    ]);
    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());

    // 改一个字段让"保存修改"变为可点(dirty)
    const textInput = screen.getByDisplayValue('开场') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: '改过的开场' } });

    const saveBtn = screen.getByText('保存修改');
    fireEvent.click(saveBtn);

    await waitFor(() => expect(screen.getAllByText((_, el) => el?.textContent?.includes('第 1 镜') ?? false).length).toBeGreaterThan(0));
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('需要填数字') ?? false).length).toBeGreaterThan(0);

    // 保存请求确实打了 PUT
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
  });

  it('409 冲突提示刷新', async () => {
    mockFetchSequence([
      () => filmPlanGetBody,
      () => ({ success: false, message: '任务状态刚刚变化(可能切换了渲染器或已开始处理), 请刷新后重试' }),
    ]);
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === 'PUT') {
        return {
          ok: false, status: 409,
          json: async () => ({ success: false, message: '任务状态刚刚变化(可能切换了渲染器或已开始处理), 请刷新后重试' }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => filmPlanGetBody } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
    const textInput = screen.getByDisplayValue('开场') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: '改过的开场' } });
    fireEvent.click(screen.getByText('保存修改'));
    await waitFor(() => expect(screen.getByText(/请刷新后重试/)).not.toBeNull());
  });

  it('“重新生成分镜”确认文案含“覆盖”', async () => {
    render(<FilmPlanWorkbench productionId="f1" onStatusChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('film-plan-workbench')).not.toBeNull());
    fireEvent.click(screen.getByText('重新生成分镜'));
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('覆盖') ?? false).length).toBeGreaterThan(0);
  });
});
