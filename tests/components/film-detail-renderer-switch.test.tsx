// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/*
 * 复审补(二十九期 Task 2 收尾): 渲染方式切换按钮只对已迁移到 Remotion 的 mode
 * 显示——延续本文件"不可用即隐藏"的既有模式(film-detail-status.test.tsx 已经在
 * 验证的那种)。之前只按 canStartProduction 显隐, talking-head-broll 这类还没有
 * 对应 Remotion handler 的 mode 也能被切成 'remotion', 徽标显示「新版渲染」但
 * 实际仍走旧管线出片——标签与行为不一致, 是用户可见的误导, 这里锁住修复后的行为。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { FilmDetail } from '@/components/films/film-detail';

const base = {
  id: 'f1', title: '测试片', mode: 'ppt-narration', status: 'queued',
  createdAt: '2026-08-30', errorMessage: null, hasPreview: false, hasMaster: false,
  templateName: '图文口播', scriptDraftId: null, publishedUrl: null,
  scenes: [], captions: [], savedLayouts: {}, brollEnabled: true,
  frame: { width: 1920, height: 1080 }, freezeReport: null, renderer: 'legacy', productionNotice: null,
};

afterEach(cleanup);

describe('成片详情的渲染方式切换按钮', () => {
  it('mode=ppt-narration(已迁移) + 可启动状态 → 显示切换按钮', () => {
    render(<FilmDetail initial={base} />);
    expect(screen.getByText('切换到新版渲染')).not.toBeNull();
  });

  it('mode=illustration-tts(已迁移) + 可启动状态 → 显示切换按钮', () => {
    render(<FilmDetail initial={{ ...base, mode: 'illustration-tts' }} />);
    expect(screen.getByText('切换到新版渲染')).not.toBeNull();
  });

  it('mode=talking-head-broll(未迁移) + 可启动状态 → 不显示切换按钮, 即便状态允许开工', () => {
    render(<FilmDetail initial={{ ...base, mode: 'talking-head-broll' }} />);
    expect(screen.queryByText('切换到新版渲染')).toBeNull();
    expect(screen.queryByText('切换到旧版渲染')).toBeNull();
    // 徽标本身(当前是什么渲染方式)不受影响——只是不给切换的入口。
    expect(screen.getByText('旧版渲染')).not.toBeNull();
  });

  it('未迁移 mode 即便当前 renderer 已经是 remotion(历史脏数据), 也不显示切换按钮', () => {
    render(<FilmDetail initial={{ ...base, mode: 'talking-head-broll', renderer: 'remotion' }} />);
    expect(screen.getByText('新版渲染')).not.toBeNull();
    expect(screen.queryByText('切换到旧版渲染')).toBeNull();
  });
});
