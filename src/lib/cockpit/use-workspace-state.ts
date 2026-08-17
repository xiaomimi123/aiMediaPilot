"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_CONTENT_TYPES,
  DEFAULT_CREATOR_PROFILE,
  DEFAULT_DESIGN_STYLE,
  DEFAULT_NAVIGATION_ORDER,
  DEFAULT_PAGE_TITLES,
  DEFAULT_SCHEDULE_OBJECT_TYPES,
  DEFAULT_STAGE_COLORS,
  type ContentItem,
  type GoalCycle,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { ConflictError, loadWorkspace, saveWorkspace } from "@/lib/cockpit/storage";
import { date, shiftDate } from "@/components/cockpit/shared";

// 下面这一小簇函数 (blankTopic/blankScript/currentQuarterRange/createGoal/createContent)
// 是 createDemoState 的依赖，随 createDemoState 一并从 Cockpit.tsx 搬到这里（原样搬迁，
// 不改逻辑）。其中 createContent 在 Cockpit.tsx 里还有其它调用点（创建空白内容/从灵感
// 转化等），故导出后由 Cockpit.tsx 改为从本文件导入，避免两处各写一份。

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

export function createContent(partial: Partial<ContentItem> & Pick<ContentItem, "id" | "title">): ContentItem {
  return {
    id: partial.id,
    title: partial.title,
    idea: partial.idea ?? partial.title,
    contentType: partial.contentType ?? DEFAULT_CONTENT_TYPES[0],
    tier: partial.tier ?? "B",
    // 三期 IA 演化: platform 字段 —— 调用方 (createBlankContent/createContentFromInspiration)
    // 按 profile.primaryPlatform 映射后传入; demo/blank 骨架数据没有 profile 上下文, 回退 'douyin'。
    platform: partial.platform ?? "douyin",
    // 十期: intent 字段 —— 可写字段, 处理方式照 platform, 未指定时回退 '' (未设置)。
    intent: partial.intent ?? "",
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

export function createDemoState(): WorkspaceState {
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

export interface UseWorkspaceStateResult {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  hydrated: boolean;
  showOnboarding: boolean;
  setShowOnboarding: (value: boolean) => void;
  conflicted: boolean;
  refreshWorkspace: () => Promise<void>;
}

export function useWorkspaceState(
  opts: { onLoadError?: (message: string) => void; onSaveError?: (message: string) => void },
): UseWorkspaceStateResult {
  const [state, setState] = useState<WorkspaceState>(() => createDemoState());
  const [hydrated, setHydrated] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  // 记录首次从服务端加载成功的 state 对象引用 — 加载后 setState(stored) 会触发一次
  // 自动保存 effect, 但那次保存的内容跟服务端刚给的一模一样 (echo), 纯粹白白占用一次
  // PUT、拉长并发窗口。只要 state 还是这个引用本身 (没被用户或任何逻辑改过), 就跳过。
  const loadedStateRef = useRef<WorkspaceState | null>(null);

  // R1 终审修复: 雷达视图 (`RadarView`) 是独立自取数视图, 不消费/不写
  // `WorkspaceState`——但「收入灵感库」(adopt) 会在服务端事务里新增一条
  // CockpitInspiration 并 bump cockpit rev (见 `radar/items/[id]/route.ts` 顶部
  // 注释)，本标签页内存里的 state 对此一无所知。若不刷新: ①切回「灵感库选题」
  // 视图看不到新卡片，要整页刷新才有；②本地 rev 已落后于服务端 (adopt 那次事务
  // 已经把 rev+1)，用户接下来的任何编辑触发自动保存都会被 409 拒绝、弹出
  // conflicted 横幅，表现成"自动保存坏了"。这里复用挂载时加载的同一条
  // echo-save 抑制路径 (`loadedStateRef`): 拉取服务端最新 state 后原地替换 state
  // 与 rev，并把它记成"刚加载"的引用，跳过紧随其后的那次 echo 保存。
  const refreshWorkspace = useCallback(async () => {
    const stored = await loadWorkspace();
    if (stored) {
      loadedStateRef.current = stored;
      setState(stored);
    }
  }, []);

  useEffect(() => {
    loadWorkspace()
      .then((stored) => {
        if (stored) {
          loadedStateRef.current = stored;
          setState(stored);
        }
        else setShowOnboarding(true);
      })
      .catch(() => opts.onLoadError?.("本地数据读取失败，已先使用当前数据。"))
      .finally(() => setHydrated(true));
  }, []);

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
        opts.onSaveError?.("自动保存失败，请检查网络后重试。");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, showOnboarding, conflicted]);

  return { state, setState, hydrated, showOnboarding, setShowOnboarding, conflicted, refreshWorkspace };
}
