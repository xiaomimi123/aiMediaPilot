// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * 月度内容规划问答式向导(三十八期 Task 4)。
 *
 * 照 `workbench-follow-template.test.tsx`/`film-plan-workbench.test.tsx` 先例:
 * `OnboardingWizard` 是纯 props 进(初始档案/模板列表) + fetch 副作用出的组件,
 * 用 `vi.stubGlobal('fetch', ...)` 按 url 分发 mock 响应, 断言调用顺序而不是
 * 挂整套 /plan 页面。
 */
import { OnboardingWizard } from '@/components/plan/onboarding-wizard';

const EMPTY_PROFILE = {
  audience: '', targetFans: '', pillars: [], angle: '', avoid: '',
  painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '',
};
const EMPTY_VOICE = { origin: '', identity: '', notIdentity: '', stances: [], energy: '' };

const ESTABLISHED_PROFILE = {
  ...EMPTY_PROFILE,
  audience: '想用 AI 但总卡在选型的普通人',
  pillars: [{ name: '工具评测', description: '真实测评 AI 工具能不能用' }],
};
const ESTABLISHED_VOICE = { ...EMPTY_VOICE, identity: '做过 3 年 AI 产品经理' };

const templates = [
  { id: 'tpl-1', name: '图文口播', deliveryMode: 'ppt-narration' },
  { id: 'tpl-2', name: '真人出镜', deliveryMode: 'talking-head-broll' },
];

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

async function goToLastStep() {
  // step 0 已建档(confirm 态)→ 直接下一步
  fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
  await waitFor(() => expect(screen.getByText('给谁看？')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await waitFor(() => expect(screen.getByText('你有什么可讲？')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await waitFor(() => expect(screen.getByText('每周拍几条？')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await waitFor(() => expect(screen.getByText('选一个默认模板')).toBeTruthy());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OnboardingWizard: 已建档 vs 未建档', () => {
  it('已建档(pillars/audience/identity 有值)→ 第①②③步展示确认卡/预填值，不是空输入', async () => {
    stubFetch({});
    render(
      <OnboardingWizard
        templates={templates}
        initialProfile={ESTABLISHED_PROFILE}
        initialVoice={ESTABLISHED_VOICE}
        onDone={() => {}}
      />,
    );
    // 第①步: 已有支柱 → 确认卡(可编辑输入框里已经有值), 而不是自由文本输入框
    expect(screen.queryByPlaceholderText(/比如：我平时喜欢折腾/)).toBeNull();
    expect(screen.getByDisplayValue('工具评测')).toBeTruthy();
    expect(screen.getByDisplayValue('真实测评 AI 工具能不能用')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('给谁看？')).toBeTruthy());
    // 第②步: audience 预填
    expect((screen.getByLabelText('受众') as HTMLInputElement).value).toBe(
      '想用 AI 但总卡在选型的普通人',
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('你有什么可讲？')).toBeTruthy());
    // 第③步: identity 预填
    expect((screen.getByLabelText('身份') as HTMLInputElement).value).toBe('做过 3 年 AI 产品经理');
  });

  it('未建档 → 第①步是自由文本输入框，不是确认卡', () => {
    stubFetch({});
    render(
      <OnboardingWizard
        templates={templates}
        initialProfile={EMPTY_PROFILE}
        initialVoice={EMPTY_VOICE}
        onDone={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/比如：我平时喜欢折腾/)).toBeTruthy();
    expect(screen.queryByDisplayValue('工具评测')).toBeNull();
  });
});

describe('OnboardingWizard: 第⑤步模板下拉', () => {
  it('渲染传入的模板列表为下拉选项', async () => {
    stubFetch({});
    render(
      <OnboardingWizard
        templates={templates}
        initialProfile={ESTABLISHED_PROFILE}
        initialVoice={ESTABLISHED_VOICE}
        onDone={() => {}}
      />,
    );
    await goToLastStep();
    const select = screen.getByLabelText('默认模板') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels.some((t) => t?.includes('图文口播'))).toBe(true);
    expect(optionLabels.some((t) => t?.includes('真人出镜') && t.includes('需自己拍口播'))).toBe(true);
  });
});

describe('OnboardingWizard: 保存时序', () => {
  it('点击生成 → 档案 PUT 在 generate 之前', async () => {
    stubFetch({
      '/api/v1/persona/profile': (url, init) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return { success: true, data: { ...ESTABLISHED_PROFILE, established: true } };
        }
        return { success: true, data: { ...ESTABLISHED_PROFILE, established: true } };
      },
      '/api/v1/content-plans/generate': () => ({ success: true, data: { planId: 'plan-1' } }),
    });
    const onDone = vi.fn();
    render(
      <OnboardingWizard
        templates={templates}
        initialProfile={ESTABLISHED_PROFILE}
        initialVoice={ESTABLISHED_VOICE}
        onDone={onDone}
      />,
    );
    // 改一下 audience，让 profile 判定为 dirty，才会真的触发 PUT
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('给谁看？')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('受众'), { target: { value: '改过的受众描述' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('你有什么可讲？')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('每周拍几条？')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('选一个默认模板')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '生成我的 30 天规划' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('plan-1'));

    const putIdx = calls.findIndex(
      (c) => c.url.includes('/api/v1/persona/profile') && c.method === 'PUT',
    );
    const genIdx = calls.findIndex((c) => c.url.includes('/api/v1/content-plans/generate'));
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(genIdx).toBeGreaterThan(putIdx);
  });

  it('generate 失败 → 出现「从这一步重试」，重点击不再重复 PUT 档案', async () => {
    let generateCallCount = 0;
    stubFetch({
      '/api/v1/persona/profile': (url, init) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return { success: true, data: { ...ESTABLISHED_PROFILE, established: true } };
        }
        return { success: true, data: { ...ESTABLISHED_PROFILE, established: true } };
      },
      '/api/v1/content-plans/generate': () => {
        generateCallCount += 1;
        if (generateCallCount === 1) {
          return { success: false, message: '规划生成失败，请重试' };
        }
        return { success: true, data: { planId: 'plan-2' } };
      },
    });
    const onDone = vi.fn();
    render(
      <OnboardingWizard
        templates={templates}
        initialProfile={ESTABLISHED_PROFILE}
        initialVoice={ESTABLISHED_VOICE}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('给谁看？')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('受众'), { target: { value: '改过的受众描述' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('你有什么可讲？')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('每周拍几条？')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('选一个默认模板')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '生成我的 30 天规划' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '从这一步重试' })).toBeTruthy());

    const putCountBeforeRetry = calls.filter(
      (c) => c.url.includes('/api/v1/persona/profile') && c.method === 'PUT',
    ).length;
    expect(putCountBeforeRetry).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '从这一步重试' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('plan-2'));

    const putCountAfterRetry = calls.filter(
      (c) => c.url.includes('/api/v1/persona/profile') && c.method === 'PUT',
    ).length;
    expect(putCountAfterRetry).toBe(1); // 重试不再重复 PUT 档案
  });
});
