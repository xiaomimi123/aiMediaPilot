// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

// 十六期 T4: HomePipelineView 组合测试。整个组件只做「平台 tab 切换」+「今日推进
// 展开/收起」两块新 UI 状态，下方看板/展开区完全委托给三个既有组件
// (ContentOverviewView/PlatformView/MomentumView)。为了不依赖这三个组件的内部
// DOM 结构 (它们各自已有独立测试覆盖)，这里 mock 掉三个子组件模块，只断言
// HomePipelineView 自己负责的路由逻辑：传了哪个 mock、传了什么 platform prop。

vi.mock("@/components/cockpit/views/pipeline", () => ({
  ContentOverviewView: () => <div data-testid="mock-content-overview">ContentOverviewView</div>,
}));

vi.mock("@/components/cockpit/views/platform", () => ({
  PlatformView: (props: { platform: string }) => (
    <div data-testid="mock-platform-view" data-platform={props.platform}>PlatformView</div>
  ),
}));

vi.mock("@/components/cockpit/views/momentum", () => ({
  MomentumView: () => <div data-testid="mock-momentum-view">MomentumView</div>,
}));

import { HomePipelineView } from "@/components/cockpit/views/home-pipeline";

afterEach(() => {
  cleanup();
});

// 组件需要的既有 props 很多，但绝大多数对这个组件自身的路由逻辑是透传性质的
// (直接转发给三个 mock 子组件)，测试里用最小可用的占位实现即可。
function baseProps(overrides: Partial<Parameters<typeof HomePipelineView>[0]> = {}) {
  const state = {
    contents: [],
    contentTypes: [],
    stageColors: {},
    stageEvents: [],
  } as unknown as Parameters<typeof HomePipelineView>[0]["state"];

  return {
    initialPlatform: undefined,
    state,
    pageTitle: "内容总览",
    updateTitle: vi.fn(),
    query: "",
    setQuery: vi.fn(),
    type: "全部类型",
    setType: vi.fn(),
    open: vi.fn(),
    addToday: vi.fn(),
    dropStage: vi.fn(),
    createContentForPlatform: vi.fn(),
    todayEntries: [],
    overdueEntries: [],
    momentumPeriod: "today" as const,
    setMomentumPeriod: vi.fn(),
    momentumPageTitle: "今日推进",
    momentumPageTitleFallback: "今日推进",
    updateMomentumPageTitle: vi.fn(),
    openReview: vi.fn(),
    moveToday: vi.fn(),
    toggleComplete: vi.fn(),
    removeFromToday: vi.fn(),
    schedule: vi.fn(),
    moveEvent: vi.fn(),
    unschedule: vi.fn(),
    createReviewDay: vi.fn(),
    moveReviewDay: vi.fn(),
    removeReviewDay: vi.fn(),
    saveLive: vi.fn(),
    moveLive: vi.fn(),
    removeLive: vi.fn(),
    saveObjectType: vi.fn(),
    archiveObjectType: vi.fn(),
    removeObjectType: vi.fn(),
    saveObject: vi.fn(),
    moveObject: vi.fn(),
    removeObject: vi.fn(),
    configureColors: vi.fn(),
    ...overrides,
  } as Parameters<typeof HomePipelineView>[0];
}

describe("HomePipelineView", () => {
  it("initialPlatform=undefined 时渲染 ContentOverviewView", () => {
    render(<HomePipelineView {...baseProps()} />);
    expect(screen.getByTestId("mock-content-overview")).toBeTruthy();
    expect(screen.queryByTestId("mock-platform-view")).toBeNull();
  });

  it("initialPlatform='douyin' 时渲染 PlatformView 且 platform prop 为 douyin", () => {
    render(<HomePipelineView {...baseProps({ initialPlatform: "douyin" })} />);
    const platformView = screen.getByTestId("mock-platform-view");
    expect(platformView).toBeTruthy();
    expect(platformView.getAttribute("data-platform")).toBe("douyin");
    expect(screen.queryByTestId("mock-content-overview")).toBeNull();
  });

  it("从「全部」起始态点击「抖音」tab 后切换为 PlatformView platform=douyin", () => {
    render(<HomePipelineView {...baseProps()} />);
    expect(screen.getByTestId("mock-content-overview")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "抖音" }));
    expect(screen.queryByTestId("mock-content-overview")).toBeNull();
    const platformView = screen.getByTestId("mock-platform-view");
    expect(platformView.getAttribute("data-platform")).toBe("douyin");
  });

  it("点击展开控件后 MomentumView 出现，再点一次收起后消失", () => {
    render(<HomePipelineView {...baseProps()} />);
    expect(screen.queryByTestId("mock-momentum-view")).toBeNull();
    const toggle = screen.getByRole("button", { name: /今日推进/ });
    fireEvent.click(toggle);
    expect(screen.getByTestId("mock-momentum-view")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("mock-momentum-view")).toBeNull();
  });

  it("摘要文案里包含 todayEntries/overdueEntries 的真实数值", () => {
    const todayEntries = [{}, {}, {}] as unknown as ReturnType<typeof baseProps>["todayEntries"];
    const overdueEntries = [{}] as unknown as ReturnType<typeof baseProps>["overdueEntries"];
    render(<HomePipelineView {...baseProps({ todayEntries, overdueEntries })} />);
    expect(screen.getByText(/3/).textContent).toContain("3");
    const summary = screen.getByTestId("home-momentum-summary-text");
    expect(summary.textContent).toContain("3");
    expect(summary.textContent).toContain("1");
  });
});
