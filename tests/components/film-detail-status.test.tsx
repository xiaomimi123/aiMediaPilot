// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/*
 * 状态区合并的回归测试。
 *
 * 合并的动因是量出来的: 页面副标题 +「等你」卡 + 阶段条三块共占 293px, 而视口 771px
 * —— **38% 的首屏在重复同一句话**(「这条片子停在预览就绪、等你确认导出」), 把真正
 * 要看的画面和它的毛病推到折叠线以下。这里锁住的是「它们必须在同一张卡里」,
 * 免得以后又有人把进度条拆出去单独占一份边距。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { FilmDetail } from '@/components/films/film-detail';

const base = {
  id: 'f1', title: '测试片', mode: 'ppt-narration', status: 'preview_ready',
  createdAt: '2026-08-30', errorMessage: null, hasPreview: true, hasMaster: false,
  templateName: '图文口播', scriptDraftId: null, publishedUrl: null,
  scenes: [], captions: [], savedLayouts: {}, brollEnabled: true,
  frame: { width: 1920, height: 1080 }, freezeReport: null,
};

afterEach(cleanup);

describe('成片详情的状态区', () => {
  it('「等你」徽标与阶段条在**同一个卡片**里 —— 拆成两块时它们在说同一件事, 却各占一份边距', () => {
    render(<FilmDetail initial={base} />);
    const badge = screen.getByText('等你');
    const card = badge.closest('[data-testid="film-status"]');
    expect(card).not.toBeNull();
    // 阶段条必须在同一张卡里
    expect(card?.textContent).toContain('预览就绪');
    expect(card?.textContent).toContain('构思分镜');
  });

  it('失败时不画阶段条 —— 把失败画成「进行到某一步」是在美化它', () => {
    render(<FilmDetail initial={{ ...base, status: 'failed', errorMessage: '渲染炸了' }} />);
    const card = screen.getByText('失败').closest('[data-testid="film-status"]');
    expect(card?.textContent).toContain('渲染炸了');
    expect(card?.textContent).not.toContain('构思分镜');
  });

  it('状态卡只出现一次 —— 合并的目的就是不再有第二处说同一件事', () => {
    const { container } = render(<FilmDetail initial={base} />);
    expect(container.querySelectorAll('[data-testid="film-status"]').length).toBe(1);
  });
});
