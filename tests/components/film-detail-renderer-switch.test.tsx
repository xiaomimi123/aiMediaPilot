// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/*
 * 三十期 Task 3: 旧渲染层整体删除后, 渲染方式切换从"新旧来回切换"收窄成
 * "legacy → remotion 的单向迁移"——PATCH 路由拒绝任何写回 'legacy' 的请求
 * (见该路由 RendererSchema), 组件侧不再需要"未迁移 mode 不给切换入口"这层
 * 判断(REMOTION_READY_MODES 现在三个交付模式都在清单里, 这层判断已经形同虚设),
 * 单纯按 `film.renderer !== 'remotion'` 决定要不要展示说明文字 + 切换按钮。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { FilmDetail } from '@/components/films/film-detail';

const base = {
  id: 'f1', title: '测试片', mode: 'ppt-narration', status: 'queued',
  createdAt: '2026-08-30', errorMessage: null, hasPreview: false, hasSource: false, hasMaster: false,
  templateName: '图文口播', scriptDraftId: null, publishedUrl: null,
  scenes: [], captions: [], savedLayouts: {}, brollEnabled: true,
  frame: { width: 1920, height: 1080 }, freezeReport: null, renderer: 'legacy', productionNotice: null,
};

afterEach(cleanup);

describe('成片详情的渲染方式徽标与切换', () => {
  it('renderer=legacy + 可启动状态 → 展示说明文字 + 切换按钮', () => {
    render(<FilmDetail initial={base} />);
    expect(screen.getByText('旧版渲染(已下线)')).not.toBeNull();
    expect(screen.getByText((_, el) => el?.textContent?.startsWith('这条历史任务用旧渲染生成，旧渲染已下线，无法重新生成') ?? false)).not.toBeNull();
    expect(screen.getByText('切换到新版渲染')).not.toBeNull();
  });

  it('renderer=legacy + 不可启动状态(已在处理中) → 不显示切换按钮, 但说明文字仍在', () => {
    render(<FilmDetail initial={{ ...base, status: 'directing' }} />);
    expect(screen.getByText((_, el) => el?.textContent?.startsWith('这条历史任务用旧渲染生成，旧渲染已下线，无法重新生成') ?? false)).not.toBeNull();
    expect(screen.queryByText('切换到新版渲染')).toBeNull();
  });

  it('renderer=remotion → 只展示徽标, 没有说明文字也没有切换按钮', () => {
    render(<FilmDetail initial={{ ...base, renderer: 'remotion' }} />);
    expect(screen.getByText('新版渲染')).not.toBeNull();
    expect(screen.queryByText('切换到新版渲染')).toBeNull();
    expect(screen.queryByText(/这条历史任务用旧渲染生成/)).toBeNull();
  });

  it('不再提供"切换到旧版渲染"这个方向——旧渲染已下线, 只剩单向迁移', () => {
    render(<FilmDetail initial={base} />);
    expect(screen.queryByText('切换到旧版渲染')).toBeNull();
  });
});
