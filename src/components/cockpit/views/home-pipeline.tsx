"use client";

import { useState, type DragEvent } from "react";
import {
  CONTENT_PLATFORMS,
  PLATFORM_LABELS,
  type ContentPlatformEx,
  type ContentStage,
  type LiveSession,
  type ScheduleObject,
  type ScheduleObjectType,
  type WorkspaceState,
  type WorkStage,
} from "@/lib/cockpit/model";
import type { MomentumPeriod } from "@/lib/cockpit/view-routing";
import { ContentOverviewView } from "./pipeline";
import { PlatformView } from "./platform";
import { MomentumView, type DailyStageEntry } from "./momentum";

// 十六期 T4: 新首页组合视图——把既有的 ContentOverviewView/PlatformView (看板)
// 与 MomentumView (今日推进) 组合进一页：顶部一条可展开的「今日推进」摘要条，
// 下方是平台 tab 切换的看板区。三个子组件本身不改一行——只是把 Cockpit.tsx
// 原来分散在多个互斥 view 分支里的调用搬进这一个组件内部的本地状态分支。
export function HomePipelineView(props: {
  // 平台 tab 初始预选 (来自 resolveInitialHomePlatform，Task 5 传入)
  initialPlatform: ContentPlatformEx | undefined;

  // ContentOverviewView / PlatformView 共用的既有 props (与 Cockpit.tsx 现有调用完全一致)
  state: WorkspaceState;
  pageTitle: string;
  updateTitle: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  open: (id: string) => void;
  addToday: (id: string) => void;
  dropStage: (event: DragEvent, stage: ContentStage) => void;
  createContentForPlatform: (platform: ContentPlatformEx) => void;

  // 顶部摘要条用 (今日/逾期统计，来自 Cockpit.tsx 现有 todayEntries/overdueEntries 计算)
  todayEntries: DailyStageEntry[];
  overdueEntries: DailyStageEntry[];

  // 展开态渲染整个 MomentumView 需要的全部既有 props (与 Cockpit.tsx 现有
  // `<MomentumView ... />` 调用完全一致，逐字透传，见 Cockpit.tsx:640-669)
  momentumPeriod: MomentumPeriod;
  setMomentumPeriod: (period: MomentumPeriod) => void;
  momentumPageTitle: string;
  momentumPageTitleFallback: string;
  updateMomentumPageTitle: (value: string) => void;
  openReview: () => void;
  moveToday: (eventId: string, direction: -1 | 1) => void;
  toggleComplete: (eventId: string) => void;
  removeFromToday: (eventId: string) => void;
  schedule: (contentId: string, stage: WorkStage, plannedDate: string) => void;
  moveEvent: (eventId: string, plannedDate: string) => void;
  unschedule: (contentId: string, stage: WorkStage) => void;
  createReviewDay: (plannedDate: string) => void;
  moveReviewDay: (reviewDayId: string, plannedDate: string) => void;
  removeReviewDay: (reviewDayId: string) => void;
  saveLive: (session: LiveSession) => void;
  moveLive: (liveSessionId: string, plannedDate: string) => void;
  removeLive: (liveSessionId: string) => void;
  saveObjectType: (type: ScheduleObjectType) => void;
  archiveObjectType: (typeId: string) => void;
  removeObjectType: (typeId: string) => void;
  saveObject: (object: ScheduleObject) => void;
  moveObject: (objectId: string, plannedDate: string) => void;
  removeObject: (objectId: string) => void;
  configureColors: () => void;
}) {
  // tab 切换只改本地状态，不影响 URL (与 view 状态一致：?view= 只在首次挂载读一次)。
  const [platform, setPlatform] = useState<ContentPlatformEx | undefined>(props.initialPlatform);
  const [expanded, setExpanded] = useState(false);

  return <section className="page home-pipeline-page">
    <div className="card-minimal home-momentum-summary">
      <div className="home-momentum-summary-row">
        <span data-testid="home-momentum-summary-text">
          你有 {props.todayEntries.length} 条内容待推进，{props.overdueEntries.length} 条已逾期
        </span>
        <button
          type="button"
          className="text-button home-momentum-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起今日推进 ↑" : "展开今日推进 ↓"}
        </button>
      </div>
      {expanded ? <MomentumView
        momentumPeriod={props.momentumPeriod}
        setMomentumPeriod={props.setMomentumPeriod}
        pageTitle={props.momentumPageTitle}
        pageTitleFallback={props.momentumPageTitleFallback}
        updatePageTitle={props.updateMomentumPageTitle}
        state={props.state}
        todayEntries={props.todayEntries}
        overdueEntries={props.overdueEntries}
        open={props.open}
        openReview={props.openReview}
        moveToday={props.moveToday}
        toggleComplete={props.toggleComplete}
        removeFromToday={props.removeFromToday}
        schedule={props.schedule}
        moveEvent={props.moveEvent}
        unschedule={props.unschedule}
        createReviewDay={props.createReviewDay}
        moveReviewDay={props.moveReviewDay}
        removeReviewDay={props.removeReviewDay}
        saveLive={props.saveLive}
        moveLive={props.moveLive}
        removeLive={props.removeLive}
        saveObjectType={props.saveObjectType}
        archiveObjectType={props.archiveObjectType}
        removeObjectType={props.removeObjectType}
        saveObject={props.saveObject}
        moveObject={props.moveObject}
        removeObject={props.removeObject}
        configureColors={props.configureColors}
      /> : null}
    </div>

    <div className="home-platform-tabs" role="tablist" aria-label="平台切换">
      <button
        type="button"
        className={platform === undefined ? "active" : ""}
        role="tab"
        aria-selected={platform === undefined}
        onClick={() => setPlatform(undefined)}
      >
        全部
      </button>
      {CONTENT_PLATFORMS.map((item) => (
        <button
          key={item}
          type="button"
          className={platform === item ? "active" : ""}
          role="tab"
          aria-selected={platform === item}
          onClick={() => setPlatform(item)}
        >
          {PLATFORM_LABELS[item]}
        </button>
      ))}
    </div>

    {platform === undefined ? <ContentOverviewView
      state={props.state}
      pageTitle={props.pageTitle}
      updateTitle={props.updateTitle}
      query={props.query}
      setQuery={props.setQuery}
      type={props.type}
      setType={props.setType}
      open={props.open}
      addToday={props.addToday}
      dropStage={props.dropStage}
    /> : <PlatformView
      platform={platform}
      state={props.state}
      pageTitle={props.pageTitle}
      updateTitle={props.updateTitle}
      query={props.query}
      setQuery={props.setQuery}
      type={props.type}
      setType={props.setType}
      open={props.open}
      addToday={props.addToday}
      dropStage={props.dropStage}
      createContent={() => props.createContentForPlatform(platform)}
    />}
  </section>;
}
