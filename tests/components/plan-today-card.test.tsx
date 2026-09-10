// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/*
 * 三十八期 Task 5: `/plan` 今日卡三态。
 *
 * 照 `plan-onboarding.test.tsx` 先例: 按 url 子串分发 mock fetch 响应, 断言调用
 * 顺序与次数, 不挂整个 /plan 页面。
 */
import { TodayCard } from '@/components/plan/today-card';

const templates = [{ id: 'tpl-1', name: '图文口播' }];

let calls: { url: string; method: string; body?: unknown }[];

function stubFetch(handlers: Record<string, (url: string, init?: RequestInit) => unknown>) {
  calls = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    for (const key of Object.keys(handlers)) {
      if (url.includes(key)) {
        const result = handlers[key](url, init);
        return { ok: true, status: 200, json: async () => result } as unknown as Response;
      }
    }
    throw new Error(`未 mock 的请求: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TodayCard - pending', () => {
  const pendingDay = {
    topic: '为什么你的 AI 提示词总是不好使',
    angle: '从常见错误反推正确写法',
    hookDirection: '先抛一个所有人都踩过的坑',
    status: 'pending' as const,
    scriptDraftId: null,
    videoProductionId: null,
  };

  it('渲染选题/角度/钩子方向 + 三个按钮', () => {
    stubFetch({});
    render(
      <TodayCard
        planId="plan1"
        dayIndex={1}
        day={pendingDay}
        templates={templates}
        defaultTemplateId={null}
      />,
    );
    expect(screen.getByText(pendingDay.topic)).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成今日脚本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '换个选题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '改一改' })).toBeTruthy();
  });

  it('点生成今日脚本 → 调 scripts/generate 再 PATCH mark-scripted, 显示等待文案', async () => {
    stubFetch({
      'scripts/generate': () => ({ success: true, data: { scriptDraftId: 'sd1' } }),
      '/days/1': () => ({ success: true, data: {} }),
    });
    render(
      <TodayCard planId="plan1" dayIndex={1} day={pendingDay} templates={templates} defaultTemplateId={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成今日脚本' }));
    expect(screen.getByText(/AI 正在写今天的逐字稿/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('今天的脚本已就绪')).toBeTruthy());
    expect(calls.some((c) => c.url.includes('scripts/generate') && c.method === 'POST')).toBe(true);
    expect(
      calls.some((c) => c.url.includes('/days/1') && c.method === 'PATCH' && (c.body as { action: string }).action === 'mark-scripted'),
    ).toBe(true);
  });

  it('生成成功但 PATCH 失败(syncFailed) → 显示重试卡, 重试只发一次 PATCH, 不再调 scripts/generate', async () => {
    const fn = stubFetch({
      'scripts/generate': () => ({ success: true, data: { scriptDraftId: 'sd1' } }),
    });
    // 第一次 PATCH 失败, 手写一个 fetch 版本: scripts/generate 成功, days/1 PATCH 返回失败
    fn.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      if (url.includes('scripts/generate')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { scriptDraftId: 'sd1' } }) } as unknown as Response;
      }
      if (url.includes('/days/1')) {
        // 第一次(来自 generateTodayScript 内部)失败, 第二次(重试按钮)成功
        const patchCallsSoFar = calls.filter((c) => c.url.includes('/days/1') && c.method === 'PATCH').length;
        if (patchCallsSoFar <= 1) {
          return { ok: false, status: 500, json: async () => ({ success: false, message: '写入失败' }) } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as unknown as Response;
      }
      throw new Error(`未 mock 的请求: ${method} ${url}`);
    });

    render(
      <TodayCard planId="plan1" dayIndex={1} day={pendingDay} templates={templates} defaultTemplateId={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成今日脚本' }));
    await waitFor(() => expect(screen.getByText(/但状态没记上/)).toBeTruthy());

    const generateCallsBeforeRetry = calls.filter((c) => c.url.includes('scripts/generate')).length;
    expect(generateCallsBeforeRetry).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '重试同步状态' }));
    await waitFor(() => expect(screen.getByText('今天的脚本已就绪')).toBeTruthy());

    // 重试之后 scripts/generate 调用次数必须仍然是 1 —— 绝不重新生成脚本
    const generateCallsAfterRetry = calls.filter((c) => c.url.includes('scripts/generate')).length;
    expect(generateCallsAfterRetry).toBe(1);
  });

  it('换个选题 → 调 reroll 接口, 更新选题展示', async () => {
    stubFetch({
      '/reroll': () => ({ success: true, data: { topic: '新选题', angle: '新角度', hookDirection: '新钩子' } }),
    });
    render(
      <TodayCard planId="plan1" dayIndex={1} day={pendingDay} templates={templates} defaultTemplateId={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '换个选题' }));
    await waitFor(() => expect(screen.getByText('新选题')).toBeTruthy());
  });

  it('改一改 → 内联编辑 + 保存走 PATCH edit', async () => {
    stubFetch({
      '/days/1': () => ({ success: true, data: {} }),
    });
    render(
      <TodayCard planId="plan1" dayIndex={1} day={pendingDay} templates={templates} defaultTemplateId={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '改一改' }));
    const topicInput = screen.getByLabelText('选题') as HTMLInputElement;
    fireEvent.change(topicInput, { target: { value: '改过的选题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('改过的选题')).toBeTruthy());
    expect(
      calls.some((c) => c.method === 'PATCH' && (c.body as { action: string }).action === 'edit'),
    ).toBe(true);
  });
});

describe('TodayCard - scripted', () => {
  const scriptedDay = {
    topic: '选题A',
    angle: '角度A',
    hookDirection: '钩子A',
    status: 'scripted' as const,
    scriptDraftId: 'sd1',
    videoProductionId: null,
  };

  it('渲染脚本就绪卡 + 链接 + 出片按钮', () => {
    stubFetch({});
    render(
      <TodayCard planId="plan1" dayIndex={2} day={scriptedDay} templates={templates} defaultTemplateId="tpl-1" />,
    );
    expect(screen.getByText('今天的脚本已就绪')).toBeTruthy();
    expect(screen.getByText('看 / 改稿 →').closest('a')!.getAttribute('href')).toBe('/write/sd1');
    expect(screen.getByRole('button', { name: '用模板出片' })).toBeTruthy();
  });

  it('点用模板出片 → 调 produce 再 PATCH mark-produced', async () => {
    stubFetch({
      'video-templates': () => ({ success: true, data: { videoProductionId: 'vp1' } }),
      '/days/2': () => ({ success: true, data: {} }),
    });
    render(
      <TodayCard planId="plan1" dayIndex={2} day={scriptedDay} templates={templates} defaultTemplateId="tpl-1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '用模板出片' }));
    await waitFor(() => expect(screen.getByText('今天完成了 🎉')).toBeTruthy());
    expect(calls.some((c) => c.url.includes('video-templates') && c.method === 'POST')).toBe(true);
    expect(
      calls.some((c) => c.url.includes('/days/2') && c.method === 'PATCH' && (c.body as { action: string }).action === 'mark-produced'),
    ).toBe(true);
  });
});

describe('TodayCard - produced', () => {
  it('渲染完成态 + 成片链接', () => {
    stubFetch({});
    render(
      <TodayCard
        planId="plan1"
        dayIndex={3}
        day={{
          topic: '选题B',
          angle: '角度B',
          hookDirection: '钩子B',
          status: 'produced',
          scriptDraftId: 'sd2',
          videoProductionId: 'vp2',
        }}
        templates={templates}
        defaultTemplateId={null}
      />,
    );
    expect(screen.getByText('今天完成了 🎉')).toBeTruthy();
    expect(screen.getByText('看成片 →').closest('a')!.getAttribute('href')).toBe('/films/vp2');
  });
});
