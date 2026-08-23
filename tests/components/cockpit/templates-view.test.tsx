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
    await waitFor(() => expect(screen.getAllByText('预设').length).toBe(2));
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
