"use client";

import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  calculateGoalHealth,
  currentFollowers,
  publishedWithin,
  todayISO,
} from "@/lib/cockpit/calculations";
import {
  CONTENT_STAGES,
  DEFAULT_PAGE_TITLES,
  DEFAULT_STAGE_COLORS,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  type ContentItem,
  type ContentPlatformEx,
  type ContentStage,
  type CreatorProfile,
  type DesignStyle,
  type GoalCycle,
  type InspirationCard,
  type LiveSession,
  type PageTitleKey,
  type ScheduleObject,
  type ScheduleObjectType,
  type WorkStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import {
  addReviewDay,
  archiveScheduleObjectType as archiveScheduleObjectTypeInWorkspace,
  moveLiveSession as moveLiveSessionInWorkspace,
  moveReviewDay as moveReviewDayInWorkspace,
  removeLiveSession as removeLiveSessionFromWorkspace,
  removeReviewDay as removeReviewDayFromWorkspace,
  removeScheduleObject as removeScheduleObjectFromWorkspace,
  removeScheduleObjectType as removeScheduleObjectTypeFromWorkspace,
  saveScheduleObject as saveScheduleObjectInWorkspace,
  saveScheduleObjectType as saveScheduleObjectTypeInWorkspace,
  saveLiveSession as saveLiveSessionInWorkspace,
  moveScheduleObject as moveScheduleObjectInWorkspace,
} from "@/lib/cockpit/schedule";
import { completeContentReview, deleteContentFromWorkspace } from "@/lib/cockpit/workspace";
import { createContent, createDemoState, useWorkspaceState } from "@/lib/cockpit/use-workspace-state";
import { saveWorkspace } from "@/lib/cockpit/storage";
import {
  canScheduleStage,
  completedPublishingEvents,
  moveStageEventToDate,
  moveStageEvent,
  overdueStageEvents,
  removeStageEvent,
  scheduleContentForDate,
  scheduleStageForDate,
  setContentStageCompletion,
  sortStageEvents,
  toggleStageEvent,
  transitionContentStage,
} from "@/lib/cockpit/workflow";
import { nextStageFor, stageLabelFor } from "@/lib/cockpit/platform-stages";
import { TAB_TO_STAGE } from "@/lib/cockpit/stage-tab-map";
import { Icon, creatorMark, dashboardTitle, date, normalizeGoalQuotas, shiftDate } from "./shared";
import { MOBILE_NAV_ITEMS, Sidebar } from "./sidebar";
import {
  isPlatformNavView,
  resolveInitialAnalyticsTab,
  resolveInitialMomentumTab,
  resolveInitialView,
  type AnalyticsTab,
  type MomentumPeriod,
  type NavView,
} from "@/lib/cockpit/view-routing";
import { PositioningView } from "./views/positioning";
import { InspirationPoolView } from "./views/inspirations";
import { RadarView } from "./views/radar";
import { MomentumView, type DailyStageEntry } from "./views/momentum";
import { ContentOverviewView } from "./views/pipeline";
import { PlatformView } from "./views/platform";
import { AnalyticsView } from "./views/analytics";
import { SettingsView } from "./views/settings";
import { Onboarding } from "./onboarding";
import type { ContentDrawerTab } from "./content-detail";

type ColorTheme = "light" | "dark";

const APP_VERSION = "1.5.0";
const VERSION_HISTORY = [
  {
    version: "1.5.0",
    title: "灵感墙与个性化工作台",
    date: "2026-07-29",
    changes: [
      "灵感池升级为左右布局的灵感墙，卡片支持详情查看、编辑和转为内容。",
      "侧边栏主页面支持拖拽自定义顺序，并同步保存到本机与完整备份。",
      "统一灵感卡片的固定高度、上下区域对齐和多风格显示效果。",
    ],
  },
  {
    version: "1.3.0",
    title: "五套风格，自定义你的创作空间",
    date: "2026-07-29",
    changes: [
      "新增安静编辑部、瑞士海报、未来实验室、复古操作台与包豪斯积木五套设计风格。",
      "外观风格支持即时切换、本地保存与完整备份恢复。",
      "安静编辑部继续支持浅色与深色，其余风格暂提供浅色版本。",
    ],
  },
  {
    version: "1.2.0",
    title: "灵感先行，内容更好找",
    date: "2026-07-29",
    changes: [
      "新增独立灵感池，灵感不再计入内容数据。",
      "支持从灵感卡片创建内容，以及新建内容时选择灵感。",
      "内容管线升级为内容总览，提供流程与列表两种视图。",
      "新增版本记录、更新前备份提醒与导入预览。",
    ],
  },
  {
    version: "1.1.0",
    title: "完整的个人内容生产工作台",
    date: "2026-07-25",
    changes: [
      "新增今日 Todo、本周总览与可拖拽档期规划。",
      "完善大目标、复盘实验室、运营日程与阶段配色。",
      "加入深色模式、侧边栏收缩和个性化配置。",
    ],
  },
  {
    version: "1.0.0",
    title: "创作者管理看板初版",
    date: "2026-07-18",
    changes: [
      "建立内容阶段管线、发布管理和本地数据保存。",
      "提供完整 JSON 备份与恢复。",
    ],
  },
] as const;

// 三期 IA 演化: platform 字段 —— profile.primaryPlatform 是自由文本 (见 onboarding/settings 的
// datalist 建议项), 这里做尽力而为的关键词映射; 匹配不到任何已知平台时回退 'douyin'。
function primaryPlatformToContentPlatform(primaryPlatform: string): ContentPlatformEx {
  const value = primaryPlatform.trim().toLowerCase();
  if (value.includes("小红书") || value.includes("xiaohongshu")) return "xiaohongshu";
  if (value.includes("b站") || value.includes("bilibili")) return "bilibili";
  if (value.includes("youtube")) return "youtube";
  if (value === "x" || value.includes("twitter") || value.includes("推特")) return "x";
  if (value.includes("公众号") || value.includes("gongzhonghao")) return "gongzhonghao";
  return "douyin";
}

function titleFromInspiration(text: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "未命名内容";
  return firstLine.length > 32 ? `${firstLine.slice(0, 32)}…` : firstLine;
}

function createBlankState(): WorkspaceState {
  const demo = createDemoState();
  return {
    ...demo,
    inspirationCards: [],
    contents: [],
    stageEvents: [],
    reviewDays: [],
    liveSessions: [],
    scheduleObjectTypes: demo.scheduleObjectTypes.filter((item) => item.kind !== "custom"),
    scheduleObjects: [],
    followerSnapshots: [],
    insightRules: [],
    pageTitles: { ...demo.pageTitles, goals: DEFAULT_PAGE_TITLES.goals },
    goal: { ...demo.goal, objective: "", outputTarget: 0, quotas: demo.goal.quotas.map((q) => ({ ...q, target: 0 })), followerStart: 0, followerTarget: 0, qualityTarget: 0 },
  };
}

// `?view=`/`?tab=` 的解析逻辑搬到 @/lib/cockpit/view-routing.ts（纯函数, 有独立单测）——
// goals/review 过渡期兼容、schedule 回退 momentum(今日)、tab 仅在 view=momentum 时生效
// 这几条规则的注释和实现都在那边, 这里只消费 resolveInitialView/resolveInitialMomentumTab。

export default function Cockpit() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [toast, setToast] = useState("");
  const {
    state,
    setState,
    hydrated,
    showOnboarding,
    setShowOnboarding,
    conflicted,
    refreshWorkspace,
  } = useWorkspaceState({
    onLoadError: (message) => setToast(message),
    onSaveError: (message) => setToast(message),
  });
  const [view, setView] = useState<NavView>(() => resolveInitialView(searchParams));
  const [momentumPeriod, setMomentumPeriod] = useState<MomentumPeriod>(() => resolveInitialMomentumTab(searchParams, view));
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>(() => resolveInitialAnalyticsTab(searchParams, view));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<ColorTheme | null>(null);
  const [showStageColors, setShowStageColors] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCreateContent, setShowCreateContent] = useState(false);
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [pipelineType, setPipelineType] = useState("全部类型");
  const workspaceTitle = dashboardTitle(state.profile);

  // 原加载 effect 里 setTheme("light") 的替代: 该行为是 Cockpit.tsx 专属的主题
  // 副作用 (新整页页面有自己的主题继承方式), 不搬进 useWorkspaceState hook。这里
  // 只在 hydrated 从 false→true 那一刻触发一次, 与原逻辑等价 (原本也只在加载完成
  // 的回调里判断一次)。
  useEffect(() => {
    if (hydrated && state.designStyle !== "editorial") setTheme("light");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    document.title = workspaceTitle;
  }, [workspaceTitle]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem("creator-cockpit-theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.style = state.designStyle;
    try {
      window.localStorage.setItem("creator-cockpit-style", state.designStyle);
    } catch {}
  }, [state.designStyle]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const health = useMemo(() => calculateGoalHealth(state.goal, state.contents, state.followerSnapshots), [state]);
  const publishedQuarter = useMemo(() => publishedWithin(state.contents, state.goal.startDate, state.goal.endDate), [state.contents, state.goal]);
  const followers = currentFollowers(state.goal, state.followerSnapshots);
  const todayEntries = sortStageEvents(state.stageEvents.filter((event) => SCHEDULABLE_STAGES.includes(event.stage) && event.plannedDate === date))
    .map((event) => {
      const item = state.contents.find((content) => content.id === event.contentId);
      return item ? { event, item } : null;
    })
    .filter((entry): entry is DailyStageEntry => Boolean(entry));
  const overdueEntries = overdueStageEvents(state.stageEvents, date)
    .map((event) => {
      const item = state.contents.find((content) => content.id === event.contentId);
      return item ? { event, item } : null;
    })
    .filter((entry): entry is DailyStageEntry => Boolean(entry));
  // T4 恢复: 侧栏「内容数据分析」徽标 —— 已发布、未完成复盘、且已过 T+3 的内容数量
  // （T2 移除 goals/review 独立侧栏项时一并拿掉，逻辑与 T2 之前完全一致，原样搬回）。
  const reviewDueCount = state.contents.filter(
    (item) =>
      item.publicationStatus === "published" &&
      !item.review.completedAt &&
      Boolean(item.publishedAt) &&
      shiftDate(item.publishedAt, 3) <= date,
  ).length;

  function updateContent(id: string, patch: Partial<ContentItem>) {
    setState((prev) => ({
      ...prev,
      contents: prev.contents.map((item) => item.id === id ? { ...item, ...patch, updatedAt: todayISO() } : item),
    }));
  }

  // AI 生成脚本回填专用: 相比 updateContent 直接替换 `script` 整块, 这里对
  // `script` 做字段级合并 (`{ ...item.script, ...partial }`) 并读取回填时刻
  // 最新的 `item.script`——而不是抽屉打开/点击生成那一刻捕获的闭包值。
  // 生成是异步的, 用户很可能在等待期间已经手改了脚本字段 (闭包里的 item 是旧的);
  // 若在调用点直接 `{ ...item.script, ...patch }` 再整体 update, 会用那份过期
  // 的 script 覆盖掉用户这段时间的编辑。
  function mergeScript(id: string, partial: Partial<ContentItem["script"]>) {
    setState((prev) => ({
      ...prev,
      contents: prev.contents.map((item) => item.id === id
        ? { ...item, script: { ...item.script, ...partial }, updatedAt: todayISO() }
        : item),
    }));
  }

  function updatePageTitle(key: PageTitleKey, value: string) {
    setState((prev) => ({ ...prev, pageTitles: { ...prev.pageTitles, [key]: value } }));
  }

  function toggleTheme() {
    if (state.designStyle !== "editorial") {
      setToast("当前风格暂仅支持浅色模式");
      return;
    }
    setTheme((current) => current === "dark" ? "light" : "dark");
  }

  function updateDesignStyle(designStyle: DesignStyle) {
    if (designStyle !== "editorial") setTheme("light");
    setState((prev) => ({ ...prev, designStyle }));
  }

  function openContent(id: string, tab?: ContentDrawerTab) {
    const stepQuery = tab && tab !== "overview" ? `?step=${TAB_TO_STAGE[tab]}` : "";
    router.push(`/content/detail/${id}${stepQuery}`);
  }

  function deleteContent(item: ContentItem) {
    const confirmed = window.confirm(`确定永久删除「${item.title}」吗？\n\n它会同时从今日 Todo、档期、大目标统计和复盘中移除，且无法恢复。`);
    if (!confirmed) return;
    setState((prev) => deleteContentFromWorkspace(prev, item.id));
    setToast("内容已永久删除");
  }

  function updateGoal(patch: Partial<GoalCycle>) {
    setState((prev) => {
      const goal = { ...prev.goal, ...patch };
      if (Object.hasOwn(patch, "outputTarget") || Object.hasOwn(patch, "quotas")) {
        goal.quotas = normalizeGoalQuotas(goal.outputTarget, goal.quotas);
      }
      return { ...prev, goal };
    });
  }

  function createBlankContent() {
    const item = createContent({
      id: crypto.randomUUID(),
      title: "未命名内容",
      platform: primaryPlatformToContentPlatform(state.profile.primaryPlatform),
      createdAt: todayISO(),
      updatedAt: todayISO(),
    });
    const nextState = { ...state, contents: [item, ...state.contents] };
    setState(nextState);
    setShowCreateContent(false);
    // 导航前显式落盘: openContent 会 router.push 到独立路由并卸载本组件树 (含
    // useWorkspaceState 的 250ms 防抖保存计时器), 若只 setState 不主动 save,
    // 该计时器永远不会触发, 新建内容从未真正写入服务端 (十四期改造后新增的
    // 竞态, 详见 README §已知问题/task-6-report.md)。best-effort、不 await —
    // 只需保证请求在卸载前已发出即可。
    saveWorkspace(nextState).catch(() => {});
    openContent(item.id);
  }

  function openCreateContent() {
    setShowCreateContent(true);
  }

  // 三期 T5: 平台流水线页「+ 新建内容」——走和 createBlankContent 相同的落库路径
  // (直接创建 + 打开抽屉)，只是 platform 由调用方 (当前所在的 platform-* 页) 预置，
  // 而不是从 profile.primaryPlatform 猜测。不经过 CreateContentModal 的两选一弹层：
  // 平台页本身已经是"选了要做哪个平台"的入口，弹层的"从灵感池选择"分支也没有平台
  // 预置能力，硬塞会两头不讨好，直接创建是更轻的路径。
  function createContentForPlatform(platform: ContentPlatformEx) {
    const item = createContent({
      id: crypto.randomUUID(),
      title: "未命名内容",
      platform,
      createdAt: todayISO(),
      updatedAt: todayISO(),
    });
    const nextState = { ...state, contents: [item, ...state.contents] };
    setState(nextState);
    // 导航前显式落盘, 原因同 createBlankContent。
    saveWorkspace(nextState).catch(() => {});
    openContent(item.id);
  }

  function createContentFromInspiration(inspiration: InspirationCard) {
    const item = createContent({
      id: crypto.randomUUID(),
      title: titleFromInspiration(inspiration.text),
      idea: inspiration.text,
      stage: "topic",
      platform: primaryPlatformToContentPlatform(state.profile.primaryPlatform),
      createdAt: todayISO(),
      updatedAt: todayISO(),
    });
    const nextState = {
      ...state,
      inspirationCards: state.inspirationCards.map((card) => card.id === inspiration.id
        ? {
            ...card,
            convertedContentIds: Array.from(new Set([...card.convertedContentIds, item.id])),
            updatedAt: new Date().toISOString(),
          }
        : card),
      contents: [item, ...state.contents],
    };
    setState(nextState);
    setShowCreateContent(false);
    // 导航前显式落盘, 原因同 createBlankContent。
    saveWorkspace(nextState).catch(() => {});
    openContent(item.id, "topic");
    setToast("已从灵感创建内容，并进入大纲阶段");
  }

  function addInspiration(text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    const now = new Date().toISOString();
    const card: InspirationCard = {
      id: crypto.randomUUID(),
      text: normalized,
      createdAt: now,
      updatedAt: now,
      convertedContentIds: [],
    };
    setState((prev) => ({ ...prev, inspirationCards: [card, ...prev.inspirationCards] }));
    setToast("灵感已存入灵感池");
  }

  function updateInspiration(id: string, text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    setState((prev) => ({
      ...prev,
      inspirationCards: prev.inspirationCards.map((card) => card.id === id
        ? { ...card, text: normalized, updatedAt: new Date().toISOString() }
        : card),
    }));
    setToast("灵感已更新");
  }

  function removeInspiration(inspiration: InspirationCard) {
    if (!window.confirm("确定删除这张灵感卡片吗？已由它创建的内容不会受到影响。")) return;
    setState((prev) => ({
      ...prev,
      inspirationCards: prev.inspirationCards.filter((card) => card.id !== inspiration.id),
    }));
    setToast("灵感卡片已删除");
  }

  function addToToday(id: string) {
    const item = state.contents.find((content) => content.id === id);
    if (!item || item.stage === "archived") return;
    if (item.stage === "inbox") {
      setToast("灵感无需排期，请先推进到大纲");
      return;
    }
    if (!canScheduleStage(state, id, item.stage, date)) {
      setToast("当前阶段与后续档期冲突，请到档期规划调整");
      return;
    }
    setState((prev) => scheduleContentForDate(prev, id, date));
    setToast("当前阶段已安排到今天");
  }

  function planStage(contentId: string, stage: WorkStage, plannedDate: string) {
    if (!plannedDate) return;
    if (!canScheduleStage(state, contentId, stage, plannedDate)) {
      setToast("排期与前后阶段冲突，请按阶段顺序安排");
      return;
    }
    const platform = state.contents.find((item) => item.id === contentId)?.platform;
    setState((prev) => scheduleStageForDate(prev, contentId, stage, plannedDate));
    setToast(`${stageLabelFor(platform ?? "", stage)}已安排到 ${plannedDate.slice(5)}`);
  }

  function clearStagePlan(contentId: string, stage: WorkStage) {
    const event = state.stageEvents.find(
      (item) => item.contentId === contentId && item.stage === stage && !item.completedAt,
    );
    if (!event) return;
    const platform = state.contents.find((item) => item.id === contentId)?.platform;
    setState((prev) => removeStageEvent(prev, event.id));
    setToast(`已取消${stageLabelFor(platform ?? "", stage)}排期`);
  }

  function moveCalendarEvent(eventId: string, plannedDate: string) {
    const event = state.stageEvents.find((item) => item.id === eventId);
    if (!event) return;
    if (!event.completedAt && !canScheduleStage(state, event.contentId, event.stage, plannedDate)) {
      setToast("改期与前后阶段冲突，请按阶段顺序安排");
      return;
    }
    const platform = state.contents.find((item) => item.id === event.contentId)?.platform;
    setState((prev) => moveStageEventToDate(prev, eventId, plannedDate));
    setToast(`${stageLabelFor(platform ?? "", event.stage)}已移动到 ${plannedDate.slice(5)}`);
  }

  function createReviewDay(plannedDate: string) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "review")?.name || "复盘";
    setState((prev) => addReviewDay(prev, plannedDate, new Date().toISOString()));
    setToast(`${typeName}已安排到 ${plannedDate.slice(5)}`);
  }

  function moveReviewDay(reviewDayId: string, plannedDate: string) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "review")?.name || "复盘";
    setState((prev) => moveReviewDayInWorkspace(prev, reviewDayId, plannedDate));
    setToast(`${typeName}已移动到 ${plannedDate.slice(5)}`);
  }

  function deleteReviewDay(reviewDayId: string) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "review")?.name || "复盘";
    setState((prev) => removeReviewDayFromWorkspace(prev, reviewDayId));
    setToast(`已取消${typeName}`);
  }

  function saveLiveSession(session: LiveSession) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "live")?.name || "直播";
    setState((prev) => saveLiveSessionInWorkspace(prev, session));
    setToast(`${typeName}日程已保存`);
  }

  function moveLiveSession(liveSessionId: string, plannedDate: string) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "live")?.name || "直播";
    setState((prev) => moveLiveSessionInWorkspace(prev, liveSessionId, plannedDate, new Date().toISOString()));
    setToast(`${typeName}已移动到 ${plannedDate.slice(5)}`);
  }

  function deleteLiveSession(liveSessionId: string) {
    const typeName = state.scheduleObjectTypes.find((item) => item.kind === "live")?.name || "直播";
    setState((prev) => removeLiveSessionFromWorkspace(prev, liveSessionId));
    setToast(`${typeName}日程已删除`);
  }

  function saveScheduleObjectType(type: ScheduleObjectType) {
    setState((prev) => saveScheduleObjectTypeInWorkspace(prev, type));
    setToast(`“${type.name.trim()}”已保存`);
  }

  function archiveScheduleObjectType(typeId: string) {
    const type = state.scheduleObjectTypes.find((item) => item.id === typeId);
    const eventCount = type?.kind === "review"
      ? state.reviewDays.length
      : type?.kind === "live"
        ? state.liveSessions.length
        : state.scheduleObjects.filter((item) => item.typeId === typeId).length;
    setState((prev) => archiveScheduleObjectTypeInWorkspace(prev, typeId));
    setToast(`已删除“${type?.name || "该类型"}”模板${eventCount ? `，保留 ${eventCount} 条已排日程` : ""}`);
  }

  function deleteScheduleObjectType(typeId: string) {
    const type = state.scheduleObjectTypes.find((item) => item.id === typeId);
    const eventCount = type?.kind === "review"
      ? state.reviewDays.length
      : type?.kind === "live"
        ? state.liveSessions.length
        : state.scheduleObjects.filter((item) => item.typeId === typeId).length;
    setState((prev) => removeScheduleObjectTypeFromWorkspace(prev, typeId));
    setToast(`已删除“${type?.name || "该类型"}”${eventCount ? `及 ${eventCount} 条日程` : ""}`);
  }

  function saveScheduleObject(object: ScheduleObject) {
    setState((prev) => saveScheduleObjectInWorkspace(prev, object));
    setToast(`${object.title.trim()}已保存`);
  }

  function moveScheduleObject(objectId: string, plannedDate: string) {
    setState((prev) => moveScheduleObjectInWorkspace(prev, objectId, plannedDate, new Date().toISOString()));
    setToast(`自定义日程已移动到 ${plannedDate.slice(5)}`);
  }

  function deleteScheduleObject(objectId: string) {
    setState((prev) => removeScheduleObjectFromWorkspace(prev, objectId));
    setToast("自定义日程已删除");
  }

  function setStageStatus(contentId: string, stage: WorkStage, completed: boolean) {
    const content = state.contents.find((item) => item.id === contentId);
    if (stage === "review" && completed && content?.publicationStatus !== "published") {
      setToast("内容发布后才能完成复盘");
      return;
    }
    if (stage === "review" && completed && (!content?.review.rating || !content.review.analysis.trim())) {
      setToast("请先到复盘页完成星级评价和复盘分析");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => {
      const withReviewStatus = stage === "review"
        ? {
            ...prev,
            contents: prev.contents.map((item) => item.id === contentId
              ? { ...item, review: { ...item.review, completedAt: completed ? completedAt : "" } }
              : item),
          }
        : prev;
      return setContentStageCompletion(withReviewStatus, contentId, stage, completed, date, completedAt);
    });
    const label = stageLabelFor(content?.platform ?? "", stage);
    setToast(completed
      ? `${label}已完成，前置阶段已同步`
      : `${label}及后续阶段已恢复待完成`);
  }

  function moveToday(eventId: string, direction: -1 | 1) {
    setState((prev) => moveStageEvent(prev, eventId, direction));
  }

  function toggleTodayComplete(eventId: string) {
    const event = state.stageEvents.find((item) => item.id === eventId);
    const item = state.contents.find((content) => content.id === event?.contentId);
    if (!event || !item) return;
    if (event.stage === "publishing") {
      openContent(item.id, "publish");
      setToast(event.completedAt ? "发布记录请在内容详情中撤销" : "先填写发布时间并标记为已发布");
      return;
    }
    const completed = Boolean(event.completedAt);
    setState((prev) => toggleStageEvent(prev, eventId, new Date().toISOString()));
    // 九期修复: 提示文案里的「下一步」也要按内容所属平台的阶段流算, 否则会和
    // toggleStageEvent 实际推进到的阶段对不上 (例如 xhs 完成文案后提示却说"进入录制")。
    const nextStage = nextStageFor(item.platform, event.stage) ?? event.stage;
    setToast(completed
      ? `已撤销，恢复到${stageLabelFor(item.platform, event.stage)}阶段`
      : `${stageLabelFor(item.platform, event.stage)}已完成，进入${stageLabelFor(item.platform, nextStage)}`);
  }

  function removeFromToday(eventId: string) {
    setState((prev) => removeStageEvent(prev, eventId));
    setToast("已移出档期");
  }

  function onDropStage(event: DragEvent, stage: ContentStage) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/content-id");
    if (!id) return;
    setState((prev) => transitionContentStage(prev, id, stage, date));
  }

  function markPublished(item: ContentItem) {
    if (!item.publishedAt) {
      setToast("请先填写实际发布时间");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => {
      const publishedItem: ContentItem = {
        ...item,
        publicationStatus: "published",
        stage: "review",
        review: { ...item.review, completedAt: "" },
        updatedAt: date,
      };
      const next = {
        ...prev,
        contents: prev.contents.map((content) => content.id === item.id ? publishedItem : content),
      };
      return {
        ...next,
        stageEvents: completedPublishingEvents(next, publishedItem, completedAt),
      };
    });
    setToast("已发布，内容已进入待复盘");
  }

  function unmarkPublished(item: ContentItem) {
    setState((prev) => {
      const publishingEvents = prev.stageEvents.filter((event) => event.contentId === item.id && event.stage === "publishing");
      const latestPublishing = [...publishingEvents].sort((a, b) => b.plannedDate.localeCompare(a.plannedDate))[0];
      let stageEvents = prev.stageEvents
        .filter((event) => !(event.contentId === item.id && event.stage === "review" && !event.completedAt))
        .map((event) => event.id === latestPublishing?.id ? { ...event, plannedDate: date, completedAt: "" } : event);
      if (!latestPublishing) {
        stageEvents = [...stageEvents, {
          id: crypto.randomUUID(),
          contentId: item.id,
          stage: "publishing",
          plannedDate: date,
          rank: 0,
          completedAt: "",
        }];
      }
      return {
        ...prev,
        contents: prev.contents.map((content) => content.id === item.id ? {
          ...content,
          publicationStatus: "scheduled",
          publishedAt: "",
          stage: "publishing",
          updatedAt: date,
        } : content),
        stageEvents,
      };
    });
    setToast("已撤销发布记录");
  }

  function saveReview(item: ContentItem) {
    if (item.publicationStatus !== "published") {
      setToast("内容发布后才能保存复盘");
      return;
    }
    if (!item.review.rating || !item.review.analysis.trim()) {
      setToast("请先完成星级评价和复盘分析");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => completeContentReview(prev, item.id, date, completedAt));
    setToast(item.review.completedAt ? "复盘已更新" : "复盘已保存，内容进入已复盘");
  }

  // 注：原 creator-cockpit 有 analyze()/copyText()/AiModal 调 /api/ai/analyze 做「AI 体检 /
  // AI 质检」，该路由本项目未移植（AI 写作走 /agent，见 content-drawer.tsx 的
  // “用 AI 写脚本”入口）。这两个函数及其状态随对应按钮一起在 Task 14 移除，避免点击后
  // fetch 404 → 静默降级成一段「请手动分析」的提示词，属于名不副实的死功能。

  function exportData() {
    const next = { ...state, lastBackupAt: new Date().toISOString() };
    setState(next);
    const blob = new Blob([JSON.stringify(next, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `内容驾驶舱-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("备份已导出");
  }

  function startWorkspace(mode: "demo" | "blank", profile: CreatorProfile) {
    const next = mode === "demo" ? createDemoState() : createBlankState();
    setState({ ...next, profile });
    setShowOnboarding(false);
  }

  return (
    <div className={sidebarCollapsed ? "cockpit-shell sidebar-collapsed" : "cockpit-shell"}>
      <Sidebar
        mode="cockpit"
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        brandTitle={workspaceTitle}
        brandMark={creatorMark(state.profile)}
        brandSubtitle={`${state.profile.primaryPlatform}${state.profile.contentFocus ? ` · ${state.profile.contentFocus}` : ""}`}
        onBrandClick={() => { setView("momentum"); setMomentumPeriod("today"); }}
        activeView={view}
        onSelectView={setView}
        onSelectSettings={() => setView("settings")}
        analyticsBadgeCount={reviewDueCount}
        timeProgress={health.timeProgress}
        weeksRemaining={health.weeksRemaining}
        appVersion={APP_VERSION}
        onOpenVersionHistory={() => setShowVersionHistory(true)}
      />

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">{creatorMark(state.profile)}</span><strong>{workspaceTitle}</strong></div>
          <div className="topbar-date"><span>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span><small>目标第 {Math.max(1, Math.ceil(((new Date().getTime() - new Date(`${state.goal.startDate}T12:00:00`).getTime()) / 86_400_000 + 1) / 7))} 周</small></div>
          <div className="topbar-actions"><button className="ghost-button topbar-theme-toggle" onClick={toggleTheme} disabled={state.designStyle !== "editorial"} aria-label={state.designStyle === "editorial" ? `切换为${theme === "dark" ? "浅色" : "深色"}模式` : "当前风格暂仅支持浅色模式"} aria-pressed={theme === "dark"} title={state.designStyle === "editorial" ? (theme === "dark" ? "切换为浅色模式" : "切换为深色模式") : "当前风格暂仅支持浅色模式"}><span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span></button><button className="primary-button" onClick={openCreateContent}><Icon name="plus" />新建内容</button></div>
        </header>

        <div className="page-scroll">
          {/* 十一期 T2: 账号定位——自取数视图, 不消费/不写 WorkspaceState (与 RadarView 同类,
              但更轻: persona/style 与 cockpit workspace 完全独立, 不需要 refreshWorkspace)。 */}
          {view === "positioning" ? <PositioningView /> : null}
          {view === "inspirations" ? <InspirationPoolView state={state} pageTitle={state.pageTitles.inspirations} updateTitle={(value) => updatePageTitle("inspirations", value)} add={addInspiration} update={updateInspiration} createContent={createContentFromInspiration} remove={removeInspiration} openContent={openContent} /> : null}
          {/* T6: 热点雷达 —— 自取数视图, 不消费 WorkspaceState (见 radar.tsx 顶部注释), 只需要 setView 用于未配置空态的「去设置」跳转。 */}
          {view === "radar" ? <RadarView setView={setView} refreshWorkspace={refreshWorkspace} /> : null}
          {view === "momentum" ? (
            <MomentumView
              momentumPeriod={momentumPeriod}
              setMomentumPeriod={setMomentumPeriod}
              pageTitle={state.pageTitles[momentumPeriod]}
              pageTitleFallback={DEFAULT_PAGE_TITLES[momentumPeriod]}
              updatePageTitle={(value) => updatePageTitle(momentumPeriod, value)}
              state={state}
              todayEntries={todayEntries}
              overdueEntries={overdueEntries}
              open={openContent}
              openReview={() => { setView("analytics"); setAnalyticsTab("review"); }}
              moveToday={moveToday}
              toggleComplete={toggleTodayComplete}
              removeFromToday={removeFromToday}
              schedule={planStage}
              moveEvent={moveCalendarEvent}
              unschedule={clearStagePlan}
              createReviewDay={createReviewDay}
              moveReviewDay={moveReviewDay}
              removeReviewDay={deleteReviewDay}
              saveLive={saveLiveSession}
              moveLive={moveLiveSession}
              removeLive={deleteLiveSession}
              saveObjectType={saveScheduleObjectType}
              archiveObjectType={archiveScheduleObjectType}
              removeObjectType={deleteScheduleObjectType}
              saveObject={saveScheduleObject}
              moveObject={moveScheduleObject}
              removeObject={deleteScheduleObject}
              configureColors={() => setShowStageColors(true)}
            />
          ) : null}
          {view === "pipeline" ? <ContentOverviewView state={state} pageTitle={state.pageTitles.pipeline} updateTitle={(value) => updatePageTitle("pipeline", value)} query={pipelineQuery} setQuery={setPipelineQuery} type={pipelineType} setType={setPipelineType} open={openContent} addToday={addToToday} dropStage={onDropStage} /> : null}
          {/* T5: 五个 platform-* 视图挂 PlatformView (产出/看板/分发三区)，platform 从 view id 推导 (`platform-${key}`)。 */}
          {isPlatformNavView(view) ? <PlatformView platform={view.slice("platform-".length) as ContentPlatformEx} state={state} pageTitle={state.pageTitles.pipeline} updateTitle={(value) => updatePageTitle("pipeline", value)} query={pipelineQuery} setQuery={setPipelineQuery} type={pipelineType} setType={setPipelineType} open={openContent} addToday={addToToday} dropStage={onDropStage} createContent={() => createContentForPlatform(view.slice("platform-".length) as ContentPlatformEx)} /> : null}
          {/* T4: analytics 挂载合并后的 AnalyticsView（目标/复盘 两个 tab，取代 T2 的 GoalsView 占位共享分支）。 */}
          {view === "analytics" ? <AnalyticsView analyticsTab={analyticsTab} setAnalyticsTab={setAnalyticsTab} state={state} goalsPageTitle={state.pageTitles.goals} updateGoalsTitle={(value) => updatePageTitle("goals", value)} health={health} followers={followers} published={publishedQuarter} updateGoal={updateGoal} notify={setToast} reviewPageTitle={state.pageTitles.review} updateReviewTitle={(value) => updatePageTitle("review", value)} open={(id) => openContent(id, "review")} setState={setState} /> : null}
          {view === "settings" ? <SettingsView state={state} pageTitle={state.pageTitles.settings} updateTitle={(value) => updatePageTitle("settings", value)} updateDesignStyle={updateDesignStyle} setState={setState} onReset={() => { if (window.confirm("确定清空全部内容与目标数据吗？个人设置会保留，请先导出备份。")) { setState({ ...createBlankState(), designStyle: state.designStyle, navigationOrder: state.navigationOrder, profile: state.profile, pageTitles: state.pageTitles }); setToast("已清空内容与目标，个人设置已保留"); } }} /> : null}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">{MOBILE_NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      {showCreateContent ? <CreateContentModal inspirationCards={state.inspirationCards} close={() => setShowCreateContent(false)} createBlank={createBlankContent} createFromInspiration={createContentFromInspiration} openInspirationPool={() => { setShowCreateContent(false); setView("inspirations"); }} /> : null}
      {showStageColors ? <StageColorModal colors={state.stageColors} close={() => setShowStageColors(false)} update={(stage, color) => setState((prev) => ({ ...prev, stageColors: { ...prev.stageColors, [stage]: color.toUpperCase() } }))} reset={() => setState((prev) => ({ ...prev, stageColors: { ...DEFAULT_STAGE_COLORS } }))} /> : null}
      {showVersionHistory ? <VersionHistoryModal close={() => setShowVersionHistory(false)} exportData={exportData} /> : null}
      {showOnboarding ? <Onboarding start={startWorkspace} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {conflicted ? (
        <div className="conflict-banner" role="alert">
          <span>数据已在其他标签页更新，此页面已停止保存 — 请刷新页面</span>
          <button onClick={() => window.location.reload()}>刷新</button>
        </div>
      ) : null}
    </div>
  );
}

function CreateContentModal({ inspirationCards, close, createBlank, createFromInspiration, openInspirationPool }: {
  inspirationCards: InspirationCard[];
  close: () => void;
  createBlank: () => void;
  createFromInspiration: (inspiration: InspirationCard) => void;
  openInspirationPool: () => void;
}) {
  const [query, setQuery] = useState("");
  const cards = [...inspirationCards]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((card) => card.text.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="create-content-modal" role="dialog" aria-modal="true" aria-labelledby="create-content-title">
      <header><div><span className="eyebrow">NEW CONTENT</span><h2 id="create-content-title">新建内容</h2><p>从已有灵感开始，或创建一条空白内容。</p></div><button className="close-button" onClick={close} aria-label="关闭新建内容">×</button></header>
      <button className="create-blank-option" onClick={createBlank}><span>＋</span><div><strong>创建空白内容</strong><small>从“灵感”阶段开始，稍后再补充详情。</small></div><em>→</em></button>
      <section className="create-from-inspiration">
        <div className="create-section-heading"><div><span>从灵感池选择</span><small>选择后会带入原始想法，并直接进入大纲阶段。</small></div>{inspirationCards.length ? <label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索灵感" /></label> : null}</div>
        {cards.length ? <div className="create-inspiration-list">{cards.map((card) => <button key={card.id} onClick={() => createFromInspiration(card)}><span>{card.text}</span><small>{card.createdAt.slice(0, 10)}</small><em>选择</em></button>)}</div> : inspirationCards.length ? <p className="create-empty-copy">没有匹配的灵感。</p> : <div className="create-empty-copy"><p>灵感池还是空的。</p><button className="text-button" onClick={openInspirationPool}>先去记录灵感 →</button></div>}
      </section>
    </section>
  </div>;
}

function VersionHistoryModal({ close, exportData }: { close: () => void; exportData: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
      <header><div><span className="eyebrow">RELEASE NOTES</span><h2 id="version-history-title">版本迭代记录</h2><p>当前版本 v{APP_VERSION}</p></div><button className="close-button" onClick={close} aria-label="关闭版本记录">×</button></header>
      <div className="update-safety-note"><Icon name="backup" /><div><strong>准备更新前，先导出一份完整备份</strong><p>Skill 更新的是本地代码，不会把浏览器里的数据上传或同步到别处。保持同一浏览器与 localhost:3000，旧数据会在新版中自动迁移。</p></div><button className="secondary-button" onClick={exportData}>导出备份</button></div>
      <div className="version-timeline">{VERSION_HISTORY.map((entry, index) => <article key={entry.version} className={index === 0 ? "current" : ""}><div className="version-marker"><i /><span>v{entry.version}</span></div><div><header><div><strong>{entry.title}</strong><time>{entry.date}</time></div>{index === 0 ? <em>当前版本</em> : null}</header><ul>{entry.changes.map((change) => <li key={change}>{change}</li>)}</ul></div></article>)}</div>
      <footer><button className="secondary-button" onClick={close}>关闭</button></footer>
    </section>
  </div>;
}

function StageColorModal({ colors, close, update, reset }: {
  colors: WorkspaceState["stageColors"];
  close: () => void;
  update: (stage: ContentStage, color: string) => void;
  reset: () => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="stage-color-modal" role="dialog" aria-modal="true" aria-labelledby="stage-color-title">
      <header><div><span className="eyebrow">STAGE COLORS</span><h2 id="stage-color-title">阶段配色</h2><p>修改后会同步到内容阶段、档期日历、今日 Todo 和内容总览。</p></div><button className="close-button" onClick={close} aria-label="关闭阶段配色">×</button></header>
      <div className="stage-color-grid">{CONTENT_STAGES.map((stage) => <label key={stage} style={{ "--stage-color": colors[stage] } as React.CSSProperties}>
        <span className="stage-color-preview"><i /></span>
        <strong>{STAGE_LABELS[stage]}</strong>
        <code>{colors[stage]}</code>
        <input type="color" value={colors[stage]} onChange={(event) => update(stage, event.target.value)} aria-label={`${STAGE_LABELS[stage]}颜色`} />
      </label>)}</div>
      <footer><button className="text-button" onClick={reset}>恢复默认配色</button><button className="primary-button" onClick={close}>完成</button></footer>
    </section>
  </div>;
}
