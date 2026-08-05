"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  calculateGoalHealth,
  currentFollowers,
  publishedWithin,
  todayISO,
} from "@/lib/cockpit/calculations";
import {
  CONTENT_STAGES,
  DEFAULT_CONTENT_TYPES,
  DEFAULT_CREATOR_PROFILE,
  DEFAULT_DESIGN_STYLE,
  DEFAULT_NAVIGATION_ORDER,
  DEFAULT_PAGE_TITLES,
  DEFAULT_SCHEDULE_OBJECT_TYPES,
  DEFAULT_STAGE_COLORS,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  type ContentItem,
  type ContentStage,
  type CreatorProfile,
  type DesignStyle,
  type GoalCycle,
  type InspirationCard,
  type InsightRule,
  type LiveSession,
  type NavigationItemId,
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
import { ConflictError, loadWorkspace, saveWorkspace } from "@/lib/cockpit/storage";
import { completeContentReview, deleteContentFromWorkspace } from "@/lib/cockpit/workspace";
import {
  canScheduleStage,
  completedPublishingEvents,
  moveStageEventToDate,
  moveStageEvent,
  nextContentStage,
  overdueStageEvents,
  removeStageEvent,
  scheduleContentForDate,
  scheduleStageForDate,
  setContentStageCompletion,
  sortStageEvents,
  toggleStageEvent,
  transitionContentStage,
} from "@/lib/cockpit/workflow";
import { EditablePageTitle, Icon, creatorMark, dashboardTitle, date, normalizeGoalQuotas, shiftDate } from "./shared";
import { NAV_ITEMS, Sidebar } from "./sidebar";
import { InspirationPoolView } from "./views/inspirations";
import { DayView, WeekOverview, type DailyStageEntry } from "./views/momentum";
import { ScheduleView } from "./views/schedule";
import { ContentOverviewView } from "./views/pipeline";
import { GoalsView } from "./views/goals";
import { ReviewView } from "./views/review";
import { SettingsView } from "./views/settings";
import { Onboarding } from "./onboarding";
import { ContentDrawer, type ContentDrawerTab } from "./content-drawer";

type NavView = NavigationItemId | "settings";
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

function blankTopic() {
  return {
    audience: "",
    painPoint: "",
    pointOfView: "",
    commonAngle: "",
    contrastAngle: "",
    assets: "",
    minimumProduction: "",
    score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
  };
}

function blankScript() {
  return { headline: "", hook: "", conclusion: "", body: "", example: "", ending: "" };
}

function createContent(partial: Partial<ContentItem> & Pick<ContentItem, "id" | "title">): ContentItem {
  return {
    id: partial.id,
    title: partial.title,
    idea: partial.idea ?? partial.title,
    contentType: partial.contentType ?? DEFAULT_CONTENT_TYPES[0],
    tier: partial.tier ?? "B",
    stage: partial.stage ?? "inbox",
    publicationStatus: partial.publicationStatus ?? "draft",
    priority: partial.priority ?? "normal",
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? shiftDate(date, -14),
    updatedAt: partial.updatedAt ?? date,
    publishedAt: partial.publishedAt ?? "",
    xhsLink: partial.xhsLink ?? "",
    coverCopy: partial.coverCopy ?? "",
    publishCopy: partial.publishCopy ?? "",
    topic: partial.topic ?? blankTopic(),
    script: partial.script ?? blankScript(),
    recordingNotes: partial.recordingNotes ?? "",
    editingNotes: partial.editingNotes ?? "",
    metrics: partial.metrics ?? { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt: "" },
    review: partial.review ?? {
      rating: 0,
      analysis: "",
      learnedRule: "",
      completedAt: "",
    },
  };
}

function titleFromInspiration(text: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "未命名内容";
  return firstLine.length > 32 ? `${firstLine.slice(0, 32)}…` : firstLine;
}

function currentQuarterRange(value = date) {
  const [year, month] = value.split("-").map(Number);
  const startMonth = Math.floor((month - 1) / 3) * 3;
  const endDay = new Date(Date.UTC(year, startMonth + 3, 0)).getUTCDate();
  return {
    id: `goal-${year}-q${Math.floor(startMonth / 3) + 1}`,
    startDate: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`,
    endDate: `${year}-${String(startMonth + 3).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function createGoal(): GoalCycle {
  const quarter = currentQuarterRange();
  return {
    id: quarter.id,
    objective: "建立稳定的内容节奏，并持续产出对受众真正有帮助的作品。",
    startDate: quarter.startDate,
    endDate: quarter.endDate,
    status: "active",
    outputTarget: 12,
    quotas: [
      { contentType: "AI 产品实测", target: 4 },
      { contentType: "AI 工作流 / 教程", target: 3 },
      { contentType: "Vibe Coding 作品", target: 2 },
      { contentType: "AI 热点观点", target: 2 },
      { contentType: "商业内容", target: 1 },
    ],
    followerStart: 1000,
    followerTarget: 2000,
    qualityMetric: "saveRate",
    qualityThreshold: 3,
    qualityTarget: 3,
  };
}

function createDemoState(): WorkspaceState {
  const goal = createGoal();
  const contents = [
    createContent({
      id: "content-ai-tools",
      title: "示例｜3 个适合新手的 AI 效率工具",
      idea: "从一个常见工作任务出发，对比三种工具分别适合什么人。",
      contentType: "AI 产品实测",
      tier: "B",
      stage: "script",
      priority: "high",
      topic: {
        audience: "刚开始尝试 AI 工具的内容创作者",
        painPoint: "工具很多，不知道该从哪一个开始",
        pointOfView: "先按具体任务选工具，比追逐功能列表更有效。",
        commonAngle: "罗列热门工具功能",
        contrastAngle: "让三个工具完成同一项任务，再比较过程和结果",
        assets: "操作录屏、结果对比、适用人群卡片",
        minimumProduction: "正面口播 + 3 段操作录屏",
        score: { audience: 5, pain: 4, scene: 5, demonstrable: 5, distribution: 4, efficiency: 4 },
      },
      script: {
        headline: "AI 工具不用装一堆，先选对这三个入口",
        hook: "如果你刚开始用 AI，最容易浪费时间的事就是同时试十几个工具。",
        conclusion: "真正重要的不是工具数量，而是它能不能稳定完成你的任务。",
        body: "1. 信息整理\n2. 内容草拟\n3. 结果检查",
        example: "展示同一份素材经过三类工具处理后的结果",
        ending: "先选一个你每周都会重复的任务开始。",
      },
    }),
    createContent({
      id: "content-weekly-review",
      title: "示例｜我用一张表复盘一周内容",
      idea: "展示如何从发布记录中快速找到下周值得继续做的方向。",
      contentType: "Vibe Coding 作品",
      tier: "A",
      stage: "editing",
      publicationStatus: "scheduled",
      priority: "high",
      topic: {
        audience: "发布后不知道该复盘什么的创作者",
        painPoint: "记录了很多数字，却没有形成下一步判断",
        pointOfView: "复盘的目的不是汇报数据，而是决定下一条内容怎么做。",
        commonAngle: "展示复杂的数据报表",
        contrastAngle: "只保留会改变下周行动的三个问题",
        assets: "示例表格、发布记录、前后判断对比",
        minimumProduction: "录屏 + 画外音",
        score: { audience: 5, pain: 5, scene: 5, demonstrable: 5, distribution: 4, efficiency: 3 },
      },
    }),
    createContent({
      id: "content-agent-guide",
      title: "示例｜第一次使用 AI Agent，要先准备什么",
      contentType: "AI 工作流 / 教程",
      tier: "C",
      stage: "topic",
      updatedAt: shiftDate(date, -4),
      topic: {
        ...blankTopic(),
        audience: "第一次尝试 Agent 的知识工作者",
        painPoint: "任务描述很长，但产出仍然不可用",
        pointOfView: "先给清楚输入、边界和验收标准，再让 Agent 开始执行。",
        contrastAngle: "不是写更长的提示词，而是先定义什么叫完成",
        score: { audience: 4, pain: 4, scene: 4, demonstrable: 3, distribution: 4, efficiency: 5 },
      },
    }),
    createContent({
      id: "content-prompt-template",
      title: "示例｜把一个提示词做成可复用模板",
      contentType: "AI 工作流 / 教程",
      tier: "B",
      stage: "publishing",
      publicationStatus: "scheduled",
      coverCopy: "从一次性提问，到每周都能复用",
      updatedAt: date,
    }),
    createContent({
      id: "content-opening-test",
      title: "示例｜我测试了 3 种视频开头",
      contentType: "AI 热点观点",
      tier: "B",
      stage: "review",
      publicationStatus: "published",
      publishedAt: shiftDate(date, -6),
      metrics: { views: 3200, likes: 180, saves: 145, comments: 22, followerGain: 48, capturedAt: shiftDate(date, -3) },
      review: {
        rating: 4,
        analysis: "结果前置的版本完播更稳定，但开头仍可以减少背景铺垫。",
        learnedRule: "教程内容先展示结果，再解释过程。",
        completedAt: "",
      },
    }),
    createContent({
      id: "content-tool-comparison",
      title: "示例｜同一项任务，我对比了 3 个 AI 工具",
      contentType: "AI 产品实测",
      tier: "B",
      stage: "archived",
      publicationStatus: "published",
      publishedAt: shiftDate(date, -10),
      metrics: { views: 1800, likes: 92, saves: 61, comments: 18, followerGain: 20, capturedAt: shiftDate(date, -7) },
      review: {
        rating: 3,
        analysis: "对比维度比较清楚，但实际操作画面不足，观众难以判断差异。",
        learnedRule: "工具对比必须使用同一份输入，并展示可验证的结果。",
        completedAt: `${shiftDate(date, -7)}T12:00:00.000Z`,
      },
    }),
    createContent({
      id: "content-note-workflow",
      title: "示例｜用 AI 整理一周工作笔记",
      contentType: "AI 工作流 / 教程",
      tier: "A",
      stage: "archived",
      publicationStatus: "published",
      publishedAt: shiftDate(date, -7),
      metrics: { views: 5600, likes: 310, saves: 288, comments: 31, followerGain: 96, capturedAt: shiftDate(date, -4) },
      review: {
        rating: 5,
        analysis: "具体输入和最终结果都展示充分，观众能够直接照着复现。",
        learnedRule: "工作流内容要同时展示原始素材和最终产物。",
        completedAt: `${shiftDate(date, -4)}T12:00:00.000Z`,
      },
    }),
    createContent({
      id: "content-idea-list",
      title: "示例｜下周可以尝试的 5 个选题",
      contentType: "AI 工作流 / 教程",
      tier: "C",
      stage: "inbox",
      updatedAt: shiftDate(date, -2),
    }),
  ];

  return {
    schemaVersion: 16,
    designStyle: DEFAULT_DESIGN_STYLE,
    navigationOrder: [...DEFAULT_NAVIGATION_ORDER],
    profile: { ...DEFAULT_CREATOR_PROFILE },
    pageTitles: { ...DEFAULT_PAGE_TITLES, goals: goal.objective },
    setupComplete: true,
    lastBackupAt: "",
    inspirationCards: [
      {
        id: "inspiration-demo-1",
        text: "测试三个 AI 工具完成同一个真实任务，看看谁的结果最能直接拿来用。",
        createdAt: `${shiftDate(date, -1)}T10:00:00.000Z`,
        updatedAt: `${shiftDate(date, -1)}T10:00:00.000Z`,
        convertedContentIds: [],
      },
      {
        id: "inspiration-demo-2",
        text: "拍一期：我做这个创作者管理看板的真实原因，以及它怎样把零散创作变成稳定产线。",
        createdAt: `${shiftDate(date, -3)}T15:30:00.000Z`,
        updatedAt: `${shiftDate(date, -3)}T15:30:00.000Z`,
        convertedContentIds: [],
      },
      {
        id: "inspiration-demo-3",
        text: "热点不一定要追新闻本身，可以把热点放进一个真实工作流里测试。",
        createdAt: `${shiftDate(date, -6)}T09:20:00.000Z`,
        updatedAt: `${shiftDate(date, -6)}T09:20:00.000Z`,
        convertedContentIds: ["content-opening-test"],
      },
    ],
    contents,
    stageEvents: [
      { id: "event-ai-tools-script", contentId: "content-ai-tools", stage: "script", plannedDate: date, rank: 1, completedAt: "" },
      { id: "event-ai-tools-record", contentId: "content-ai-tools", stage: "recording", plannedDate: date, rank: 2, completedAt: "" },
      { id: "event-weekly-review-edit", contentId: "content-weekly-review", stage: "editing", plannedDate: date, rank: 3, completedAt: "" },
      { id: "event-weekly-review-publish", contentId: "content-weekly-review", stage: "publishing", plannedDate: shiftDate(date, 2), rank: 1, completedAt: "" },
      { id: "event-agent-guide-topic", contentId: "content-agent-guide", stage: "topic", plannedDate: shiftDate(date, 1), rank: 1, completedAt: "" },
      { id: "event-agent-guide-script", contentId: "content-agent-guide", stage: "script", plannedDate: shiftDate(date, 2), rank: 2, completedAt: "" },
      { id: "event-prompt-template-publish", contentId: "content-prompt-template", stage: "publishing", plannedDate: shiftDate(date, 1), rank: 2, completedAt: "" },
      { id: "event-opening-test-publish", contentId: "content-opening-test", stage: "publishing", plannedDate: shiftDate(date, -6), rank: 0, completedAt: `${shiftDate(date, -6)}T12:00:00.000Z` },
      { id: "event-tool-comparison-publish", contentId: "content-tool-comparison", stage: "publishing", plannedDate: shiftDate(date, -10), rank: 0, completedAt: `${shiftDate(date, -10)}T12:00:00.000Z` },
      { id: "event-note-workflow-publish", contentId: "content-note-workflow", stage: "publishing", plannedDate: shiftDate(date, -7), rank: 0, completedAt: `${shiftDate(date, -7)}T12:00:00.000Z` },
    ],
    reviewDays: [
      { id: "review-day-demo", plannedDate: shiftDate(date, 3), note: "", createdAt: new Date().toISOString() },
    ],
    liveSessions: [
      {
        id: "live-demo",
        title: "示例｜内容工具答疑",
        plannedDate: shiftDate(date, 5),
        startTime: "20:00",
        endTime: "21:00",
        platform: "小红书",
        content: "演示本周使用频率最高的三个内容工具，并回答观众问题。",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    scheduleObjectTypes: [
      ...DEFAULT_SCHEDULE_OBJECT_TYPES.map((item) => ({ ...item })),
      {
        id: "schedule-type-event",
        kind: "custom",
        name: "活动",
        description: "线下活动、展会或特别安排",
        color: "#4F7A72",
        archived: false,
        createdAt: new Date().toISOString(),
      },
    ],
    scheduleObjects: [
      {
        id: "schedule-object-event-demo",
        typeId: "schedule-type-event",
        title: "示例｜内容创作者线下交流",
        plannedDate: shiftDate(date, 4),
        startTime: "14:00",
        endTime: "17:00",
        details: "准备交流提纲和现场素材清单。",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    stageColors: { ...DEFAULT_STAGE_COLORS },
    goal,
    goalHistory: [],
    followerSnapshots: [
      { id: "followers-demo-start", date: goal.startDate, followers: 1000 },
      { id: "followers-demo-current", date, followers: 1240 },
    ],
    insightRules: [
      { id: "rule-1", text: "工作流内容要同时展示原始素材和最终产物。", sourceContentId: "content-note-workflow", createdAt: shiftDate(date, -4), active: true },
      { id: "rule-2", text: "工具对比必须使用同一份输入，并展示可验证的结果。", sourceContentId: "content-tool-comparison", createdAt: shiftDate(date, -7), active: true },
    ],
    contentTypes: DEFAULT_CONTENT_TYPES,
  };
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

function initialViewFromSearchParams(searchParams: URLSearchParams): NavView {
  const requested = searchParams.get("view");
  return requested && (DEFAULT_NAVIGATION_ORDER as string[]).includes(requested)
    ? (requested as NavigationItemId)
    : "momentum";
}

export default function Cockpit() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<WorkspaceState>(() => createDemoState());
  const [hydrated, setHydrated] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [view, setView] = useState<NavView>(() => initialViewFromSearchParams(searchParams));
  const [momentumPeriod, setMomentumPeriod] = useState<"today" | "week">("today");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<ColorTheme | null>(null);
  const [showStageColors, setShowStageColors] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCreateContent, setShowCreateContent] = useState(false);
  const [draggedNavId, setDraggedNavId] = useState<NavigationItemId | null>(null);
  const [navDropTarget, setNavDropTarget] = useState<NavigationItemId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ContentDrawerTab>("overview");
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [pipelineType, setPipelineType] = useState("全部类型");
  const [toast, setToast] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const workspaceTitle = dashboardTitle(state.profile);
  // 记录首次从服务端加载成功的 state 对象引用 — 加载后 setState(stored) 会触发一次
  // 自动保存 effect, 但那次保存的内容跟服务端刚给的一模一样 (echo), 纯粹白白占用一次
  // PUT、拉长并发窗口。只要 state 还是这个引用本身 (没被用户或任何逻辑改过), 就跳过。
  const loadedStateRef = useRef<WorkspaceState | null>(null);

  useEffect(() => {
    loadWorkspace()
      .then((stored) => {
        if (stored) {
          if (stored.designStyle !== "editorial") setTheme("light");
          loadedStateRef.current = stored;
          setState(stored);
        }
        else setShowOnboarding(true);
      })
      .catch(() => setToast("本地数据读取失败，已先使用当前数据。"))
      .finally(() => setHydrated(true));
  }, []);

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
    if (!hydrated || showOnboarding || conflicted) return;
    if (state === loadedStateRef.current) return; // 跳过刚加载完那次的 echo-save
    const timer = window.setTimeout(() => {
      saveWorkspace(state).catch((err) => {
        if (err instanceof ConflictError) {
          // 服务端 rev 已失效: 别处已经保存过, 这份状态已经过期。永久停止本页后续
          // 保存 (再存只会 409 或用旧状态覆盖别人的新写入), 引导用户刷新拿最新数据。
          setConflicted(true);
          return;
        }
        setToast("自动保存失败，请检查网络后重试。");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, showOnboarding, conflicted]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = state.contents.find((item) => item.id === selectedId) ?? null;
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
  const reviewDue = state.contents.filter(
    (item) =>
      item.publicationStatus === "published" &&
      !item.review.completedAt &&
      Boolean(item.publishedAt) &&
      shiftDate(item.publishedAt, 3) <= date,
  );

  function updateContent(id: string, patch: Partial<ContentItem>) {
    setState((prev) => ({
      ...prev,
      contents: prev.contents.map((item) => item.id === id ? { ...item, ...patch, updatedAt: todayISO() } : item),
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

  function reorderNavigation(sourceId: NavigationItemId, targetId: NavigationItemId) {
    if (sourceId === targetId) return;
    if (!state.navigationOrder.includes(sourceId)) return;
    setState((prev) => {
      const sourceIndex = prev.navigationOrder.indexOf(sourceId);
      const targetIndex = prev.navigationOrder.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const next = prev.navigationOrder.filter((id) => id !== sourceId);
      const targetAfterRemoval = next.indexOf(targetId);
      next.splice(sourceIndex < targetIndex ? targetAfterRemoval + 1 : targetAfterRemoval, 0, sourceId);
      return { ...prev, navigationOrder: next };
    });
    setToast("侧边栏顺序已更新");
  }

  function moveNavigationBy(id: NavigationItemId, offset: -1 | 1) {
    const currentIndex = state.navigationOrder.indexOf(id);
    const targetId = state.navigationOrder[currentIndex + offset];
    if (!targetId) return;
    reorderNavigation(id, targetId);
  }

  function openContent(id: string, tab: ContentDrawerTab = "overview") {
    setSelectedTab(tab);
    setSelectedId(id);
  }

  function deleteContent(item: ContentItem) {
    const confirmed = window.confirm(`确定永久删除「${item.title}」吗？\n\n它会同时从今日 Todo、档期、大目标统计和复盘中移除，且无法恢复。`);
    if (!confirmed) return;
    setState((prev) => deleteContentFromWorkspace(prev, item.id));
    setSelectedId(null);
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
    const item = createContent({ id: crypto.randomUUID(), title: "未命名内容", createdAt: todayISO(), updatedAt: todayISO() });
    setState((prev) => ({ ...prev, contents: [item, ...prev.contents] }));
    setShowCreateContent(false);
    openContent(item.id);
  }

  function openCreateContent() {
    setShowCreateContent(true);
  }

  function createContentFromInspiration(inspiration: InspirationCard) {
    const item = createContent({
      id: crypto.randomUUID(),
      title: titleFromInspiration(inspiration.text),
      idea: inspiration.text,
      stage: "topic",
      createdAt: todayISO(),
      updatedAt: todayISO(),
    });
    setState((prev) => ({
      ...prev,
      inspirationCards: prev.inspirationCards.map((card) => card.id === inspiration.id
        ? {
            ...card,
            convertedContentIds: Array.from(new Set([...card.convertedContentIds, item.id])),
            updatedAt: new Date().toISOString(),
          }
        : card),
      contents: [item, ...prev.contents],
    }));
    setShowCreateContent(false);
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
    setState((prev) => scheduleStageForDate(prev, contentId, stage, plannedDate));
    setToast(`${STAGE_LABELS[stage]}已安排到 ${plannedDate.slice(5)}`);
  }

  function clearStagePlan(contentId: string, stage: WorkStage) {
    const event = state.stageEvents.find(
      (item) => item.contentId === contentId && item.stage === stage && !item.completedAt,
    );
    if (!event) return;
    setState((prev) => removeStageEvent(prev, event.id));
    setToast(`已取消${STAGE_LABELS[stage]}排期`);
  }

  function moveCalendarEvent(eventId: string, plannedDate: string) {
    const event = state.stageEvents.find((item) => item.id === eventId);
    if (!event) return;
    if (!event.completedAt && !canScheduleStage(state, event.contentId, event.stage, plannedDate)) {
      setToast("改期与前后阶段冲突，请按阶段顺序安排");
      return;
    }
    setState((prev) => moveStageEventToDate(prev, eventId, plannedDate));
    setToast(`${STAGE_LABELS[event.stage]}已移动到 ${plannedDate.slice(5)}`);
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
    setToast(completed
      ? `${STAGE_LABELS[stage]}已完成，前置阶段已同步`
      : `${STAGE_LABELS[stage]}及后续阶段已恢复待完成`);
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
    setToast(completed ? `已撤销，恢复到${STAGE_LABELS[event.stage]}阶段` : `${STAGE_LABELS[event.stage]}已完成，进入${STAGE_LABELS[nextContentStage(event.stage)]}`);
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
    setHydrated(true);
  }

  const nav = state.navigationOrder
    .map((id) => NAV_ITEMS.find((item) => item.id === id))
    .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

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
        navItems={nav}
        activeView={view}
        onSelectView={setView}
        onSelectSettings={() => setView("settings")}
        reviewDueCount={reviewDue.length}
        draggedNavId={draggedNavId}
        navDropTarget={navDropTarget}
        setDraggedNavId={setDraggedNavId}
        setNavDropTarget={setNavDropTarget}
        reorderNavigation={reorderNavigation}
        moveNavigationBy={moveNavigationBy}
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
          {view === "inspirations" ? <InspirationPoolView state={state} pageTitle={state.pageTitles.inspirations} updateTitle={(value) => updatePageTitle("inspirations", value)} add={addInspiration} update={updateInspiration} createContent={createContentFromInspiration} remove={removeInspiration} openContent={openContent} /> : null}
          {view === "momentum" ? (
            <section className="page momentum-page">
              <div className="page-heading split-heading"><div><span className="eyebrow">MOMENTUM</span><EditablePageTitle value={state.pageTitles[momentumPeriod]} fallback={DEFAULT_PAGE_TITLES[momentumPeriod]} onChange={(value) => updatePageTitle(momentumPeriod, value)} /><p>{momentumPeriod === "today" ? "今日 Todo 自动读取档期；一个任务就是一条内容的一个大阶段。" : "本周总览自动汇总档期，不需要再维护一份周计划。"}</p></div><div className="period-switch momentum-period-switch" role="tablist" aria-label="推进时间范围"><button className={momentumPeriod === "today" ? "active" : ""} onClick={() => setMomentumPeriod("today")} role="tab" aria-selected={momentumPeriod === "today"}>今日</button><button className={momentumPeriod === "week" ? "active" : ""} onClick={() => setMomentumPeriod("week")} role="tab" aria-selected={momentumPeriod === "week"}>本周</button></div></div>
              {momentumPeriod === "today" ? <DayView items={todayEntries} overdueItems={overdueEntries} stageColors={state.stageColors} open={openContent} openSchedule={() => setView("schedule")} moveToday={moveToday} toggleComplete={toggleTodayComplete} removeFromToday={removeFromToday} /> : <WeekOverview state={state} open={openContent} openSchedule={() => setView("schedule")} />}
            </section>
          ) : null}

          {view === "schedule" ? <section className="page momentum-page"><div className="page-heading"><span className="eyebrow">PRODUCTION SCHEDULE</span><EditablePageTitle value={state.pageTitles.schedule} fallback={DEFAULT_PAGE_TITLES.schedule} onChange={(value) => updatePageTitle("schedule", value)} /><p>安排内容阶段，也可以放入复盘、直播和你自定义的日程对象。</p></div><ScheduleView state={state} open={openContent} openReview={() => setView("review")} schedule={planStage} moveEvent={moveCalendarEvent} unschedule={clearStagePlan} createReviewDay={createReviewDay} moveReviewDay={moveReviewDay} removeReviewDay={deleteReviewDay} saveLive={saveLiveSession} moveLive={moveLiveSession} removeLive={deleteLiveSession} saveObjectType={saveScheduleObjectType} archiveObjectType={archiveScheduleObjectType} removeObjectType={deleteScheduleObjectType} saveObject={saveScheduleObject} moveObject={moveScheduleObject} removeObject={deleteScheduleObject} configureColors={() => setShowStageColors(true)} /></section> : null}
          {view === "pipeline" ? <ContentOverviewView state={state} pageTitle={state.pageTitles.pipeline} updateTitle={(value) => updatePageTitle("pipeline", value)} query={pipelineQuery} setQuery={setPipelineQuery} type={pipelineType} setType={setPipelineType} open={openContent} addToday={addToToday} dropStage={onDropStage} /> : null}
          {view === "goals" ? <GoalsView state={state} pageTitle={state.pageTitles.goals} updateTitle={(value) => updatePageTitle("goals", value)} health={health} followers={followers} published={publishedQuarter} updateGoal={updateGoal} setState={setState} notify={setToast} /> : null}
          {view === "review" ? <ReviewView state={state} pageTitle={state.pageTitles.review} updateTitle={(value) => updatePageTitle("review", value)} open={(id) => openContent(id, "review")} setState={setState} /> : null}
          {view === "settings" ? <SettingsView state={state} pageTitle={state.pageTitles.settings} updateTitle={(value) => updatePageTitle("settings", value)} updateDesignStyle={updateDesignStyle} setState={setState} onReset={() => { if (window.confirm("确定清空全部内容与目标数据吗？个人设置会保留，请先导出备份。")) { setState({ ...createBlankState(), designStyle: state.designStyle, navigationOrder: state.navigationOrder, profile: state.profile, pageTitles: state.pageTitles }); setToast("已清空内容与目标，个人设置已保留"); } }} /> : null}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      {showCreateContent ? <CreateContentModal inspirationCards={state.inspirationCards} close={() => setShowCreateContent(false)} createBlank={createBlankContent} createFromInspiration={createContentFromInspiration} openInspirationPool={() => { setShowCreateContent(false); setView("inspirations"); }} /> : null}
      {selected ? <ContentDrawer item={selected} initialTab={selectedTab} stageEvents={state.stageEvents} stageColors={state.stageColors} contentTypes={state.contentTypes} close={() => setSelectedId(null)} update={(patch) => updateContent(selected.id, patch)} changeStage={(stage) => setState((prev) => transitionContentStage(prev, selected.id, stage, date))} setStageStatus={(stage, completed) => setStageStatus(selected.id, stage, completed)} schedule={(stage, plannedDate) => planStage(selected.id, stage, plannedDate)} unschedule={(stage) => clearStagePlan(selected.id, stage)} remove={() => deleteContent(selected)} markPublished={() => markPublished(selected)} unmarkPublished={() => unmarkPublished(selected)} saveReview={() => saveReview(selected)} ruleDeposited={Boolean(selected.review.learnedRule.trim() && state.insightRules.some((rule) => rule.sourceContentId === selected.id && rule.text === selected.review.learnedRule.trim()))} addRule={(text) => { const normalized = text.trim(); if (!normalized) return; setState((prev) => { const existing = prev.insightRules.find((rule) => rule.sourceContentId === selected.id && rule.text === normalized); if (existing) return { ...prev, insightRules: prev.insightRules.map((rule) => rule.id === existing.id ? { ...rule, active: true } : rule) }; const rule: InsightRule = { id: crypto.randomUUID(), text: normalized, sourceContentId: selected.id, createdAt: todayISO(), active: true }; return { ...prev, insightRules: [rule, ...prev.insightRules] }; }); setToast("已沉淀为内容规则"); }} notify={setToast} /> : null}
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
