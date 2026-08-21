// 三期 IA 演化: platform 字段
// @/lib/platform 的 `ContentPlatform` 只覆盖当前已支持生成的 3 个内容创作平台
// (douyin/xiaohongshu/gongzhonghao, 对应 ScriptDraft.platform)。Cockpit 内容看板要覆盖
// 侧栏展示的更广平台集合 (含 bilibili/x/youtube), 因此这里定义一个扩展联合
// ContentPlatformEx —— 每个 `ContentPlatform` 的值都属于 `ContentPlatformEx`
// (值兼容, 非类型别名), 用于 `ContentItem.platform`。
export type ContentPlatformEx =
  | "douyin"
  | "xiaohongshu"
  | "bilibili"
  | "x"
  | "youtube"
  | "gongzhonghao";

// 侧栏平台分区顺序 —— 不含 gongzhonghao (公众号只在内容详情抽屉里用作平台标签, 不单独开侧栏分区)。
export const CONTENT_PLATFORMS: ContentPlatformEx[] = [
  "douyin",
  "xiaohongshu",
  "bilibili",
  "x",
  "youtube",
];

export const PLATFORM_LABELS: Record<ContentPlatformEx, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "bilibili",
  x: "X",
  youtube: "YouTube",
  gongzhonghao: "公众号",
};

// 十期: 账号定位体系 — 内容意图字段, 与 platform 同属可写字段
// (随 workspace PUT 落库, 见 server-store.ts)。'' 代表未设置, 宽进严出交给 validateIntent。
export const CONTENT_INTENTS = ["reach", "trust", "convert"] as const;
export type ContentIntent = "" | (typeof CONTENT_INTENTS)[number];
export const INTENT_LABELS: Record<Exclude<ContentIntent, "">, string> = {
  reach: "引流",
  trust: "建立信任",
  convert: "转化",
};

export type ContentStage =
  | "inbox"
  | "topic"
  | "script"
  | "recording"
  | "editing"
  | "publishing"
  | "review"
  | "archived";

export type WorkStage = Exclude<ContentStage, "archived">;
export type ContentTier = "A" | "B" | "C";
export type DesignStyle = "editorial" | "swiss" | "future" | "retro" | "bauhaus";
export type NavigationItemId = "inspirations" | "momentum" | "schedule" | "pipeline" | "goals" | "review";
export const DEFAULT_NAVIGATION_ORDER: NavigationItemId[] = [
  "inspirations",
  "momentum",
  "schedule",
  "pipeline",
  "goals",
  "review",
];
export type QualityMetric =
  | "views"
  | "likeRate"
  | "saveRate"
  | "commentRate"
  | "followerGain";
export interface TopicCard {
  audience: string;
  painPoint: string;
  pointOfView: string;
  commonAngle: string;
  contrastAngle: string;
  assets: string;
  minimumProduction: string;
  score: {
    audience: number;
    pain: number;
    scene: number;
    demonstrable: number;
    distribution: number;
    efficiency: number;
  };
}

export interface ScriptDraft {
  headline: string;
  hook: string;
  conclusion: string;
  body: string;
  example: string;
  ending: string;
}

export interface MetricsSnapshot {
  views: number;
  likes: number;
  saves: number;
  comments: number;
  followerGain: number;
  capturedAt: string;
}

export interface Review {
  rating: number;
  analysis: string;
  learnedRule: string;
  completedAt: string;
}

// 十九期: 交付模式收敛类型 —— manual(手动出镜) / ppt-narration(AI 图文口播,
// 原 ai-faceless 改名) / talking-head-broll(真人出镜 + B-roll) / illustration-tts(插画 TTS)。
export type DeliveryMode = 'manual' | 'ppt-narration' | 'talking-head-broll' | 'illustration-tts';

export interface ContentItem {
  id: string;
  title: string;
  idea: string;
  contentType: string;
  tier: ContentTier;
  // 三期 IA 演化: platform 字段 —— 内容归属的目标平台, 驱动侧栏按平台分区。
  platform: ContentPlatformEx;
  // 十期: 账号定位体系 —— 内容意图 (引流/建立信任/转化), 可写字段, 处理方式照 platform。
  intent: ContentIntent;
  // 十五期 C: 交付模式 (手动出镜/AI 自动生成), 可选, 缺省=manual, 零迁移。
  // 驱动 platform-stages.ts 的 stageFlowFor 分岔 (非 manual 模式各自跳过/替换阶段)。
  deliveryMode?: DeliveryMode;
  stage: ContentStage;
  publicationStatus: "draft" | "scheduled" | "published";
  priority: "high" | "normal" | "low";
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  xhsLink: string;
  coverCopy: string;
  publishCopy: string;
  topic: TopicCard;
  script: ScriptDraft;
  recordingNotes: string;
  editingNotes: string;
  // 十三期: 抖音逐字稿六幕改造 —— 六幕录制/剪辑打勾进度 (可选, 缺省=未打勾, 旧数据零迁移)。
  // 键 = ActKey (六幕脚本 act 名), 值 = 是否已录/已剪。供 StepNode 步骤条 (Task 4/5) 消费。
  recordingActProgress?: Record<string, boolean>;
  editingActProgress?: Record<string, boolean>;
  metrics: MetricsSnapshot;
  review: Review;
  // 六期: 服务端字段, 由 /api/v1/scripts/generate (douyin) best-effort 回写关联,
  // 供抽屉重开时懒加载拉回改稿 UI (T2)。只读下发——PUT /api/v1/cockpit/workspace
  // 不接收/不写这个字段 (见 server-store.ts saveWorkspaceToDb 的 data 字段列表)。
  scriptDraftId?: string | null;
}

export interface InspirationCard {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  convertedContentIds: string[];
}

export interface StageEvent {
  id: string;
  contentId: string;
  stage: WorkStage;
  plannedDate: string;
  rank: number;
  completedAt: string;
}

export interface ReviewDay {
  id: string;
  plannedDate: string;
  note: string;
  createdAt: string;
}

export interface LiveSession {
  id: string;
  title: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  platform: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleObjectKind = "review" | "live" | "custom";

export interface ScheduleObjectType {
  id: string;
  kind: ScheduleObjectKind;
  name: string;
  description: string;
  color: string;
  archived: boolean;
  createdAt: string;
}

export const DEFAULT_SCHEDULE_OBJECT_TYPES: ScheduleObjectType[] = [
  {
    id: "schedule-type-review",
    kind: "review",
    name: "复盘",
    description: "集中查看全部待复盘内容",
    color: "#82637E",
    archived: false,
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "schedule-type-live",
    kind: "live",
    name: "直播",
    description: "安排主题与直播内容",
    color: "#B45A3C",
    archived: false,
    createdAt: "1970-01-01T00:00:00.000Z",
  },
];

export interface ScheduleObject {
  id: string;
  typeId: string;
  title: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  details: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentQuota {
  contentType: string;
  target: number;
}

export interface GoalCycle {
  id: string;
  objective: string;
  startDate: string;
  endDate: string;
  status: "active" | "archived";
  outputTarget: number;
  quotas: ContentQuota[];
  followerStart: number;
  followerTarget: number;
  qualityMetric: QualityMetric;
  qualityThreshold: number;
  qualityTarget: number;
}

export interface FollowerSnapshot {
  id: string;
  date: string;
  followers: number;
}

export interface InsightRule {
  id: string;
  text: string;
  sourceContentId: string | null;
  createdAt: string;
  active: boolean;
}

export interface CreatorProfile {
  creatorName: string;
  dashboardTitle: string;
  primaryPlatform: string;
  contentFocus: string;
}

export type PageTitleKey =
  | "inspirations"
  | "today"
  | "week"
  | "schedule"
  | "pipeline"
  | "goals"
  | "review"
  | "settings";

export type PageTitles = Record<PageTitleKey, string>;

export interface WorkspaceState {
  schemaVersion: 16;
  designStyle: DesignStyle;
  navigationOrder: NavigationItemId[];
  profile: CreatorProfile;
  pageTitles: PageTitles;
  inspirationCards: InspirationCard[];
  contents: ContentItem[];
  stageEvents: StageEvent[];
  reviewDays: ReviewDay[];
  liveSessions: LiveSession[];
  scheduleObjectTypes: ScheduleObjectType[];
  scheduleObjects: ScheduleObject[];
  stageColors: Record<ContentStage, string>;
  goal: GoalCycle;
  goalHistory: GoalCycle[];
  followerSnapshots: FollowerSnapshot[];
  insightRules: InsightRule[];
  contentTypes: string[];
  setupComplete: boolean;
  lastBackupAt: string;
}

export interface GoalHealth {
  timeProgress: number;
  outputProgress: number;
  followerProgress: number;
  qualityProgress: number;
  overallProgress: number;
  status: "setting_up" | "ahead" | "on_track" | "at_risk" | "behind";
  weeksRemaining: number;
  outputRemaining: number;
  outputPerWeek: number;
  followerRemaining: number;
  followersPerWeek: number;
  pipelineCoverage: number;
  biggestRisk: string;
  recommendation: string;
}

export const STAGE_LABELS: Record<ContentStage, string> = {
  inbox: "灵感",
  topic: "大纲",
  script: "脚本",
  recording: "录制",
  editing: "剪辑",
  publishing: "发布",
  review: "复盘",
  archived: "归档",
};

export const NEXT_ACTIONS: Record<ContentStage, string> = {
  inbox: "转成大纲卡",
  topic: "确认角度与档位",
  script: "完成脚本骨架",
  recording: "完成录制",
  editing: "完成剪辑",
  publishing: "完善发布信息",
  review: "录入数据并复盘",
  archived: "已完成",
};

export const CONTENT_STAGES: ContentStage[] = [
  "inbox",
  "topic",
  "script",
  "recording",
  "editing",
  "publishing",
  "review",
  "archived",
];

export const WORK_STAGES: WorkStage[] = [
  "inbox",
  "topic",
  "script",
  "recording",
  "editing",
  "publishing",
  "review",
];

export const SCHEDULABLE_STAGES: WorkStage[] = [
  "topic",
  "script",
  "recording",
  "editing",
  "publishing",
];

export const DEFAULT_CREATOR_PROFILE: CreatorProfile = {
  creatorName: "示例创作者",
  dashboardTitle: "示例创作者的内容工作台",
  primaryPlatform: "小红书",
  contentFocus: "内容创作与效率工具",
};

export const DEFAULT_DESIGN_STYLE: DesignStyle = "editorial";

export const DEFAULT_PAGE_TITLES: PageTitles = {
  inspirations: "先收下想法，再决定要不要做成内容",
  today: "今天，只完成已经排好的阶段",
  week: "看清这一周，要把哪些内容推到哪里",
  schedule: "把内容的每个阶段，放进真实档期",
  pipeline: "在一个地方，看清所有内容的状态",
  goals: "看清这阶段，离目标还有多远",
  review: "让每次发布，都留下下一次能用的判断",
  settings: "设置与备份",
};

export const DEFAULT_STAGE_COLORS: Record<ContentStage, string> = {
  inbox: "#8C8172",
  topic: "#B1843D",
  script: "#6F7653",
  recording: "#4F7C83",
  editing: "#607A9A",
  publishing: "#BD5D3D",
  review: "#82637E",
  archived: "#7C7D76",
};

export const DEFAULT_CONTENT_TYPES = [
  "AI 产品实测",
  "AI 工作流 / 教程",
  "Vibe Coding 作品",
  "AI 热点观点",
  "商业内容",
];

export const QUALITY_LABELS: Record<QualityMetric, string> = {
  views: "播放量",
  likeRate: "点赞率",
  saveRate: "收藏率",
  commentRate: "评论率",
  followerGain: "单条涨粉",
};
