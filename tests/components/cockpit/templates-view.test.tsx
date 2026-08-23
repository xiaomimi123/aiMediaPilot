// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

// 生成进度面板已有独立测试, 这里 mock 掉只验证"传了什么 props"
vi.mock('@/components/cockpit/video-production-panel', () => ({
  VideoProductionPanel: (props: { contentId: string; deliveryMode: string }) => (
    <div data-testid="mock-panel" data-content={props.contentId} data-mode={props.deliveryMode} />
  ),
}));

import { TemplatesView } from '@/components/cockpit/views/templates';

const TEMPLATES = [
  {
    id: 't1', name: '图文口播', description: '', deliveryMode: 'ppt-narration',
    visualStyle: 'card', palette: null, voicePreset: null, scriptPrompt: null,
    captionStyle: null, bgmPath: null, bgmVolume: 0.15, introPath: null, outroPath: null, isPreset: true,
  },
  {
    id: 't2', name: '真人出镜 + B-roll', description: '', deliveryMode: 'talking-head-broll',
    visualStyle: 'card', palette: null, voicePreset: null, scriptPrompt: null,
    captionStyle: null, bgmPath: null, bgmVolume: 0.12, introPath: null, outroPath: null, isPreset: true,
  },
  {
    id: 't3', name: '插画配音', description: '', deliveryMode: 'illustration-tts',
    visualStyle: 'illustration', palette: null, voicePreset: { voiceType: 'zh_female_vv_uranus_bigtts' }, scriptPrompt: null,
    captionStyle: null, bgmPath: null, bgmVolume: 0.15, introPath: null, outroPath: null, isPreset: true,
  },
];

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return {
      ok: true,
      json: async () => ({ ok: true, data: key ? routes[key] : {} }),
    } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch({ '/api/v1/video-templates': { templates: TEMPLATES } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TemplatesView', () => {
  it('加载后列出全部模板', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    expect(screen.getByText('真人出镜 + B-roll')).toBeTruthy();
  });

  it('预设模板带徽标', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getAllByText('预设').length).toBe(TEMPLATES.length));
  });

  it('点「用它出片」进入出片向导第一步(定文案)', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);

    expect(screen.getByText(/定文案/)).toBeTruthy();
  });

  it('出片向导对真人出镜模板显示上传素材步骤, 对图文口播不显示', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    // 图文口播: 无上传步骤
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);
    expect(screen.queryByText(/上传出镜视频/)).toBeNull();

    // 退回列表, 换真人出镜模板
    fireEvent.click(screen.getByRole('button', { name: '返回模板列表' }));
    await waitFor(() => expect(screen.getByText('真人出镜 + B-roll')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[1]);
    expect(screen.getByText(/上传出镜视频/)).toBeTruthy();
  });

  it('点「编辑」打开编辑器并回填该模板的值', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    const nameInput = screen.getByLabelText('模板名称') as HTMLInputElement;
    expect(nameInput.value).toBe('图文口播');
  });
});

// code-review 回来后追加(见 task-10-report.md「审查回来后的修复」一节):
// 覆盖零模板空态 / 加载中 / 请求失败态 / 上传失败态四类此前完全没测过的边界。
describe('边界状态', () => {
  it('模板列表为空时显示空态提示', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/api/v1/video-templates': { templates: [] } }));
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('还没有模板。')).toBeTruthy());
  });

  it('请求还没返回时显示加载中', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<TemplatesView />);
    expect(screen.getByText('加载中…')).toBeTruthy();
  });

  it('加载模板列表失败(网络异常)时显示错误提示, 不会卡在加载中', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText(/加载模板列表失败/)).toBeTruthy());
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('复制失败时提示错误, 不假装刷新成功', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/duplicate')) {
        return { ok: true, json: async () => ({ ok: false, message: '复制失败' }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0]);

    await waitFor(() => expect(screen.getByText(/复制失败/)).toBeTruthy());
    // 只应该触发过一次列表 GET(初次加载)——复制失败不该"假装成功"再刷新一次列表。
    const listCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes('/duplicate'));
    expect(listCalls.length).toBe(1);
  });

  it('删除失败时提示错误, 不假装刷新成功', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return { ok: true, json: async () => ({ ok: false, message: '删除失败' }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);

    await waitFor(() => expect(screen.getByText(/删除失败/)).toBeTruthy());
    confirmSpy.mockRestore();
  });

  it('保存模板时网络异常显示错误提示', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    fireEvent.click(screen.getByRole('button', { name: /保存模板/ }));

    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeTruthy());
  });

  it('素材上传失败(网络异常)时显示错误提示', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/assets')) throw new Error('network down');
      return { ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    const bgmInput = screen.getByLabelText('BGM') as HTMLInputElement;
    const file = new File(['x'], 'bgm.mp3', { type: 'audio/mpeg' });
    fireEvent.change(bgmInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/素材上传失败/)).toBeTruthy());
  });

  it('生成六幕稿失败(网络异常)时显示错误提示', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/script')) throw new Error('network down');
      if (String(url).includes('/workspace')) return { ok: true, json: async () => ({ ok: true, data: {} }) } as Response;
      return { ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: '粘贴新写' }));
    fireEvent.change(screen.getByPlaceholderText('粘贴一段原始文字，AI 会据此写出六幕稿'), { target: { value: '这是一段足够长的测试文案内容' } });
    fireEvent.click(screen.getByRole('button', { name: /生成六幕稿/ }));

    await waitFor(() => expect(screen.getByText(/生成失败/)).toBeTruthy());
  });

  it('发起生成失败(网络异常)时显示错误提示', async () => {
    const fakeScript = { acts: [{ act: 'hook', title: '开场', narration: '大家好' }], four_dims: {} };
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/produce')) throw new Error('network down');
      if (String(url).includes('/script')) return { ok: true, json: async () => ({ ok: true, data: { script: fakeScript } }) } as Response;
      if (String(url).includes('/workspace')) return { ok: true, json: async () => ({ ok: true, data: {} }) } as Response;
      return { ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: '粘贴新写' }));
    fireEvent.change(screen.getByPlaceholderText('粘贴一段原始文字，AI 会据此写出六幕稿'), { target: { value: '这是一段足够长的测试文案内容' } });
    fireEvent.click(screen.getByRole('button', { name: /生成六幕稿/ }));
    await waitFor(() => expect(screen.getByText('开场')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(screen.getByText(/发起生成失败/)).toBeTruthy());
  });
});

// task-10b 收尾: 补齐「确认配音」步骤可编辑覆盖 + 从后端接口拉取历史出片列表(缺口2/3 的前端半边)。
describe('临时配音覆盖与历史出片(task-10b)', () => {
  const FAKE_SCRIPT = { acts: [{ act: 'hook', title: '开场', narration: '大家好' }], four_dims: {} };

  function routedFetch(overrides: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/productions')) return overrides.productions?.(url, init) ?? ({ ok: true, json: async () => ({ ok: true, data: { productions: [] } }) } as Response);
      if (String(url).includes('/script')) return overrides.script?.(url, init) ?? ({ ok: true, json: async () => ({ ok: true, data: { script: FAKE_SCRIPT } }) } as Response);
      if (String(url).includes('/produce')) return overrides.produce?.(url, init) ?? ({ ok: true, json: async () => ({ ok: true, data: { videoProductionId: 'vp1', status: 'queued', contentId: 'c1' } }) } as Response);
      if (String(url).includes('/workspace')) return overrides.workspace?.(url, init) ?? ({ ok: true, json: async () => ({ ok: true, data: {} }) } as Response);
      return overrides.list?.(url, init) ?? ({ ok: true, json: async () => ({ ok: true, data: { templates: TEMPLATES } }) } as Response);
    });
  }

  async function openIllustrationWizard(fetchMock: ReturnType<typeof routedFetch>) {
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('插画配音')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[2]);
    fireEvent.click(screen.getByRole('tab', { name: '粘贴新写' }));
    fireEvent.change(screen.getByPlaceholderText('粘贴一段原始文字，AI 会据此写出六幕稿'), { target: { value: '这是一段足够长的测试文案内容' } });
    fireEvent.click(screen.getByRole('button', { name: /生成六幕稿/ }));
    await waitFor(() => expect(screen.getByText('开场')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一步' })); // script -> voice
  }

  it('「确认配音」步骤默认回填模板的 voicePreset.voiceType, 且可编辑', async () => {
    await openIllustrationWizard(routedFetch({}));

    const voiceInput = screen.getByLabelText('配音音色（可临时覆盖）') as HTMLInputElement;
    expect(voiceInput.value).toBe('zh_female_vv_uranus_bigtts');

    fireEvent.change(voiceInput, { target: { value: 'zh_male_new_voice' } });
    expect(voiceInput.value).toBe('zh_male_new_voice');
  });

  it('配音音色改过时, 发起生成会把改动后的值作为 voiceOverride 带给 produce', async () => {
    const fetchMock = routedFetch({});
    await openIllustrationWizard(fetchMock);

    fireEvent.change(screen.getByLabelText('配音音色（可临时覆盖）'), { target: { value: 'zh_male_new_voice' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' })); // voice -> produce
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/produce'))).toBe(true));
    const produceCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/produce'))!;
    const body = JSON.parse((produceCall[1] as RequestInit).body as string);
    expect(body.voiceOverride).toEqual({ voiceType: 'zh_male_new_voice' });
  });

  it('配音音色没改动时, 发起生成不传 voiceOverride(保持"用模板预设"的语义)', async () => {
    const fetchMock = routedFetch({});
    await openIllustrationWizard(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: '下一步' })); // voice -> produce, 没改配音
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/produce'))).toBe(true));
    const produceCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/produce'))!;
    const body = JSON.parse((produceCall[1] as RequestInit).body as string);
    expect(body.voiceOverride).toBeUndefined();
  });

  it('打开出片向导时从 GET .../productions 拉取本模板的历史出片列表并展示', async () => {
    const fetchMock = routedFetch({
      productions: () => ({
        ok: true,
        json: async () => ({ ok: true, data: { productions: [
          { id: 'old-vp1', status: 'done', mode: 'illustration-tts', masterPath: '/x/master.mp4', previewPath: null, contentId: 'c-old', createdAt: '2026-08-01T00:00:00.000Z' },
        ] } }),
      } as Response),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('插画配音')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[2]);

    await waitFor(() => expect(screen.getByText('已完成')).toBeTruthy());
    expect(screen.getByRole('link', { name: '下载成片' })).toBeTruthy();
  });
});
