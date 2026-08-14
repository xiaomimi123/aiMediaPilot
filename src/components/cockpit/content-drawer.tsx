"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTENT_INTENTS,
  INTENT_LABELS,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  type ContentIntent,
  type ContentItem,
  type ContentStage,
  type StageEvent,
  type WorkStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { todayISO } from "@/lib/cockpit/calculations";
import { stageIndex } from "@/lib/cockpit/workflow";
import { isStageInFlow, nextActionFor, stageFlowFor, stageLabelFor } from "@/lib/cockpit/platform-stages";
import { mapGeneratedToScript, sectionsToScriptFields, type DouyinSection } from "@/lib/cockpit/script-mapping";
import { runGenerateScript } from "@/lib/cockpit/generate-flow";
import { parseDraftOutput } from "@/lib/cockpit/draft-restore";
import { CONTENT_PLATFORMS, CONTENT_PLATFORM_LABEL, isContentPlatform, type ContentPlatform } from "@/lib/platform";
import { Badge, Icon, StarRating } from "./shared";

// T6 三期: 抽屉内 AI 生成脚本只覆盖 @/lib/platform 的 ContentPlatform 三个值
// (douyin/xiaohongshu/gongzhonghao)，而 item.platform 是六平台的 ContentPlatformEx
// (含 bilibili/x/youtube 三个只有基础能力、platform.tsx 里已标注"暂不支持 AI 生成"
// 的平台, 见 FULL_GENERATION_PLATFORMS 注释)。生成平台下拉默认值跟随 item.platform——
// 落在三个全能力平台内直接用, 否则回退 douyin (下拉仍可手动改选其他两个全能力平台)。
function defaultScriptPlatform(platform: string): ContentPlatform {
  return isContentPlatform(platform) ? platform : "douyin";
}

async function resolveDefaultNiche(): Promise<string> {
  try {
    const res = await fetch("/api/v1/user/default-niche");
    const json = await res.json();
    if (json.success && typeof json.data?.niche === "string" && json.data.niche) return json.data.niche;
  } catch {
    // 网络失败等: 落到兜底 niche
  }
  return "general";
}

export type ContentDrawerTab = "overview" | "topic" | "script" | "recording" | "editing" | "publish" | "review";

// ---- T7: 抽屉内逐字稿分块交互 (只有 douyin 有 sections/refine 能力) — 生成响应/
// refine 响应都是未知形状 (来自 LLM 结构化输出经过 zod 校验后的 JSON, 但抽屉这层
// 仍按仓库既有习惯做一次窄化解析, 不直接信任网络响应的 TS 类型标注)。 ----

const SECTION_ROLE_LABEL: Record<string, string> = { hook: "开头钩子", main: "主体", cta: "结尾行动" };

interface ResearchPoint { fact: string; source: string; usage: string }
interface ResearchBriefView { points: ResearchPoint[] }
interface HookCandidate { text: string }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDouyinSection(value: unknown): value is DouyinSection {
  if (!isPlainRecord(value)) return false;
  return typeof value.role === "string" && typeof value.startSec === "number" && typeof value.endSec === "number" && typeof value.text === "string" && value.text.length > 0;
}

function parseSections(raw: unknown): DouyinSection[] | null {
  if (!Array.isArray(raw)) return null;
  const sections = raw.filter(isDouyinSection);
  return sections.length > 0 ? sections : null;
}

function isResearchPoint(value: unknown): value is ResearchPoint {
  if (!isPlainRecord(value)) return false;
  return typeof value.fact === "string" && typeof value.source === "string" && typeof value.usage === "string";
}

function parseResearch(raw: unknown): ResearchBriefView | null {
  if (!isPlainRecord(raw) || !Array.isArray(raw.points)) return null;
  const points = raw.points.filter(isResearchPoint);
  return points.length > 0 ? { points } : null;
}

function isHookCandidate(value: unknown): value is HookCandidate {
  return isPlainRecord(value) && typeof value.text === "string" && value.text.length > 0;
}

function parseHooks(raw: unknown): HookCandidate[] {
  return Array.isArray(raw) ? raw.filter(isHookCandidate) : [];
}

interface XhsShotIdea { idx: number; description: string }

function isXhsShotIdea(value: unknown): value is XhsShotIdea {
  return isPlainRecord(value) && typeof value.idx === "number" && typeof value.description === "string" && value.description.length > 0;
}

function parseXhsShotIdeas(raw: unknown): XhsShotIdea[] {
  return Array.isArray(raw) ? raw.filter(isXhsShotIdea).sort((a, b) => a.idx - b.idx) : [];
}

function parseXhsTags(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** 十期: 生成响应新增 `suggestedIntent` (douyin/xiaohongshu 才有, 已在路由层过 validateIntent
 * 宽进严出, 非法值降为 null) —— 这里只做类型窄化, 不重复校验合法性。 */
function isValidContentIntent(value: unknown): value is Exclude<ContentIntent, ""> {
  return typeof value === "string" && (CONTENT_INTENTS as readonly string[]).includes(value);
}

// ---- T5 七期: 出图计划 / 逐张生图结果的窄化解析 —— 消费 POST .../images/plan
// (`ok({plan})`, plan = `{style, images:[{idx,prompt}]}`) 与 POST .../images
// (`ok({idx,path})`) 两条路由的响应, 不直接信任 fetch 返回的 any 类型标注,
// 与本文件其余网络响应窄化解析同一风格 (parseSections/parseHooks 等)。
interface XhsImagePlanImage { idx: number; prompt: string }
interface XhsImagePlanView { style: string; images: XhsImagePlanImage[] }
interface XhsGeneratedImage { path: string; prompt: string; createdAt: string }

function isXhsImagePlanImage(value: unknown): value is XhsImagePlanImage {
  return isPlainRecord(value) && typeof value.idx === "number" && typeof value.prompt === "string";
}

function parseXhsImagePlan(raw: unknown): XhsImagePlanView | null {
  if (!isPlainRecord(raw) || typeof raw.style !== "string" || !Array.isArray(raw.images)) return null;
  const images = raw.images.filter(isXhsImagePlanImage);
  return images.length > 0 ? { style: raw.style, images } : null;
}

/**
 * 素材简报折叠区 —— douyin 分块面板与 T6 六期小红书面板共用同一份渲染 (「复用
 * 五期组件」), 从 ScriptSectionsPanel 内联的同款 JSX 抽出为独立子组件, 避免两处
 * 各写一份、后续改一处漏改一处。
 */
function ResearchBriefDetails({ research, researchDegraded }: { research: ResearchBriefView | null; researchDegraded: boolean }) {
  if (research) {
    return <details className="script-research-details"><summary>素材简报（{research.points.length}）</summary><ul className="script-research-list">{research.points.map((point, idx) => <li key={idx}><p className="script-research-fact">{point.fact}</p><p className="script-research-meta"><span>用法：{point.usage}</span><span>来源：{/^https?:\/\//.test(point.source) ? <a href={point.source} target="_blank" rel="noreferrer">{point.source}</a> : point.source}</span></p></li>)}</ul></details>;
  }
  return researchDegraded ? <p className="field-hint">素材检索这次降级了，稿子按主题直接生成，没有引用具体素材。</p> : null;
}

/**
 * 逐字稿分块面板 — 素材简报折叠区 + 整体指令 + 逐块渲染 (含 hook 块下方 3 候选
 * 切换, 复用 T3 已有的 /api/v1/scripts/{id}/picked 接口) + 每块「换一版」一句话
 * 指令。拆成独立组件是循 StageScheduleField/StageStatusPanel 的先例——
 * ContentDrawer 主体 return 本身已经很密, 这块逻辑独立、props 边界清楚, 抽出来
 * 单独用正常排版写更可读。
 */
function ScriptSectionsPanel({ sections, research, researchDegraded, hooks, pickedHookIdx, hookPending, onPickHook, allInstruction, onAllInstructionChange, onRefineAll, refiningAll, openSectionIdx, onToggleSection, sectionInstruction, onSectionInstructionChange, onRefineSection, refiningSectionIdx, generating, imgGenerating }: {
  sections: DouyinSection[];
  research: ResearchBriefView | null;
  researchDegraded: boolean;
  hooks: HookCandidate[];
  pickedHookIdx: number | null;
  hookPending: boolean;
  onPickHook: (idx: number) => void;
  allInstruction: string;
  onAllInstructionChange: (value: string) => void;
  onRefineAll: () => void;
  refiningAll: boolean;
  openSectionIdx: number | null;
  onToggleSection: (idx: number) => void;
  sectionInstruction: string;
  onSectionInstructionChange: (value: string) => void;
  onRefineSection: (idx: number) => void;
  refiningSectionIdx: number | null;
  generating: boolean;
  /** T5 七期: 出图 pending——与本组件覆盖的四类动作双向互斥 (见下方 busy) */
  imgGenerating: boolean;
}) {
  const anyRefining = refiningAll || refiningSectionIdx !== null;
  // T9 终审: hook 候选切换 / 换一版 / 整体指令 / 生成中(generating) 是同一草稿上
  // 互斥的四类动作 (选 hook 走 PUT picked, 换一版/整体指令走 POST refine, 生成
  // 走 POST generate 且会整体替换 scriptDraftId/sections)——原先各自只识别自己
  // 那组的 pending, 互不识别对方在途, 可并发触发同一草稿的写操作。这里统一成一个
  // busy 开关喂给全部四类控件的 disabled, 各自的「进行中」文案态 (refiningAll ?
  // "改写中…" : ... 等) 仍按各自 state 单独判断, 不受影响。T5 七期: imgGenerating
  // (出图 pending) 并入同一 busy 开关——出图与改稿共用同一份 scriptDraftId 落库,
  // 不能并发写。
  const busy = anyRefining || hookPending || generating || imgGenerating;
  return <div className="script-sections-panel">
    <ResearchBriefDetails research={research} researchDegraded={researchDegraded} />
    <div className="script-all-instruction-row">
      <input value={allInstruction} onChange={(e) => onAllInstructionChange(e.target.value)} maxLength={200} placeholder="整体指令，例如：语气更轻松一些" disabled={busy} aria-label="整体改写指令" />
      <button type="button" className="secondary-button small" disabled={busy || !allInstruction.trim()} onClick={onRefineAll}>{refiningAll ? "改写中…" : "整体指令"}</button>
    </div>
    {sections.map((section, idx) => <div key={idx} className="script-section-card">
      <div className="script-section-head">
        <strong>{SECTION_ROLE_LABEL[section.role] ?? section.role} {section.startSec}-{section.endSec}s</strong>
        <button type="button" className="text-button" disabled={busy} onClick={() => onToggleSection(idx)}>换一版</button>
      </div>
      <p className="script-section-text">{section.text}</p>
      {section.role === "hook" && hooks.length > 0 ? <div className="script-hook-picker">{hooks.map((hook, hookIdx) => <button key={hookIdx} type="button" className={hookIdx === pickedHookIdx ? "script-hook-option active" : "script-hook-option"} disabled={busy} aria-pressed={hookIdx === pickedHookIdx} onClick={() => onPickHook(hookIdx)}>候选 {hookIdx + 1}：{hook.text}</button>)}</div> : null}
      {openSectionIdx === idx ? <div className="script-instruction-row"><input value={sectionInstruction} onChange={(e) => onSectionInstructionChange(e.target.value)} maxLength={200} placeholder="一句话指令，例如：这段再犀利一点" disabled={busy} aria-label={`第 ${idx + 1} 段改写指令`} /><button type="button" className="secondary-button small" disabled={busy || !sectionInstruction.trim()} onClick={() => onRefineSection(idx)}>{refiningSectionIdx === idx ? "改写中…" : "确认"}</button></div> : null}
    </div>)}
  </div>;
}

/**
 * T6 六期: 小红书两阶段生成后的展示面板 —— 素材简报折叠区 (复用上面
 * `ResearchBriefDetails`, 与 douyin 的 `ScriptSectionsPanel` 同款) + 页顶整稿
 * 指令框 (只有 scope:'all', 小红书不支持分块改稿, 见 spec §2) + intro/body/
 * tags/shotIdeas 只读展示——六字段骨架文本框仍是唯一可编辑的落点 (照
 * douyin sections 面板的先例, 分块/整稿面板本身只读, 编辑走下方骨架文本框或
 * 指令框驱动的 refine 请求)。
 */
function XhsScriptPanel({ research, researchDegraded, intro, body, tags, shotIdeas, instruction, onInstructionChange, onRefineAll, refining, generating, imagePlan, images, imgGenerating, failedImageIdxs, onGenerateImages, onRetryImage, archiveHref }: {
  research: ResearchBriefView | null;
  researchDegraded: boolean;
  intro: string;
  body: string;
  tags: string[];
  shotIdeas: XhsShotIdea[];
  instruction: string;
  onInstructionChange: (value: string) => void;
  onRefineAll: () => void;
  refining: boolean;
  generating: boolean;
  /** T5 七期: 出图计划 (style + 每张图 prompt)——null 表示尚未点过「生成配图」/懒加载没恢复到 */
  imagePlan: XhsImagePlanView | null;
  /** 已生成的配图, 按 idx 索引, 可能是 imagePlan 的子集 (部分张已出图/部分失败) */
  images: Record<number, XhsGeneratedImage>;
  imgGenerating: boolean;
  failedImageIdxs: Set<number>;
  onGenerateImages: () => void;
  onRetryImage: (idx: number) => void;
  /** 有 scriptDraftId 才非 null——「打包下载」只在同时有 scriptDraftId 且至少一张成图时渲染 */
  archiveHref: string | null;
}) {
  const busy = refining || generating || imgGenerating;
  const hasAnyImage = Object.keys(images).length > 0;
  return <div className="script-sections-panel">
    <ResearchBriefDetails research={research} researchDegraded={researchDegraded} />
    <div className="script-all-instruction-row">
      <input value={instruction} onChange={(e) => onInstructionChange(e.target.value)} maxLength={200} placeholder="整稿指令，例如：语气更轻松一些" disabled={busy} aria-label="小红书整稿改写指令" />
      <button type="button" className="secondary-button small" disabled={busy || !instruction.trim()} onClick={onRefineAll}>{refining ? "改写中…" : "整稿指令"}</button>
    </div>
    <div className="script-section-card">
      <div className="script-section-head"><strong>开头引导</strong></div>
      <p className="script-section-text">{intro}</p>
    </div>
    <div className="script-section-card">
      <div className="script-section-head"><strong>正文</strong></div>
      <p className="script-section-text">{body}</p>
    </div>
    {tags.length > 0 ? <div className="script-section-card"><div className="script-section-head"><strong>标签</strong></div><p className="script-section-text">{tags.map((tag) => `#${tag}`).join(" ")}</p></div> : null}
    {shotIdeas.length > 0 ? <div className="script-section-card"><div className="script-section-head"><strong>配图建议</strong></div><ul className="script-research-list">{shotIdeas.map((idea) => <li key={idea.idx}><p className="script-research-fact">{idea.idx}. {idea.description}</p></li>)}</ul></div> : null}
    {/* T5 七期: 出图计划 + 缩略图网格 —— 按钮常亮 (无 key 时点击后端 503, 由父组件 notify 引导),
        点击先幂等 POST plan 拿到 imagePlan (没有则先规划), 再并发逐张 POST images, 每张成功即
        渐进渲染缩略图, 失败的格显示「重试」。「打包下载」只在至少一张成图时出现。 */}
    <div className="script-section-card script-image-section">
      <div className="script-section-head">
        <strong>配图</strong>
        <div className="script-image-actions">
          {hasAnyImage && archiveHref ? <a className="text-button" href={archiveHref} download>打包下载</a> : null}
          <button type="button" className="secondary-button small" disabled={busy} onClick={onGenerateImages}>{imgGenerating ? "生成中…" : "生成配图"}</button>
        </div>
      </div>
      {imagePlan
        ? <div className="script-image-grid">{imagePlan.images.map((img) => {
          const done = images[img.idx];
          const failed = failedImageIdxs.has(img.idx);
          return <div key={img.idx} className="script-image-tile">
            {done
              ? <a href={done.path} target="_blank" rel="noreferrer"><img src={done.path} alt={`配图 ${img.idx + 1}`} /></a>
              : failed
                ? <div className="script-image-tile-state failed"><span>生成失败</span><button type="button" className="text-button" disabled={imgGenerating} onClick={() => onRetryImage(img.idx)}>重试</button></div>
                : <div className="script-image-tile-state pending"><span>{imgGenerating ? "生成中…" : "待生成"}</span></div>}
          </div>;
        })}</div>
        : <p className="field-hint">点击「生成配图」自动规划并生成整套配图（封面 + 正文配图）。</p>}
    </div>
  </div>;
}

function StageScheduleField({ item, stage, stageEvents, schedule, unschedule, label = "计划完成时间" }: {
  item: ContentItem;
  stage: WorkStage;
  stageEvents: StageEvent[];
  schedule: (stage: WorkStage, plannedDate: string) => void;
  unschedule: (stage: WorkStage) => void;
  label?: string;
}) {
  const event = stageEvents.find((entry) => entry.contentId === item.id && entry.stage === stage && !entry.completedAt);
  const historical = item.stage === "archived" || stageIndex(item.stage) > stageIndex(stage);
  return <div className={`stage-schedule-field ${historical ? "historical" : ""}`}>
    <div><span>{label}</span><small>{historical ? "该阶段已经完成" : "修改后会同步到档期日历"}</small></div>
    <input type="date" value={event?.plannedDate ?? ""} disabled={historical} onChange={(changeEvent) => changeEvent.target.value ? schedule(stage, changeEvent.target.value) : unschedule(stage)} aria-label={`${stageLabelFor(item.platform, stage)}${label}`} />
    {event && !historical ? <button type="button" onClick={() => unschedule(stage)}>取消排期</button> : null}
  </div>;
}

function StageStatusPanel({ item, stageColors, setStageStatus }: {
  item: ContentItem;
  stageColors: WorkspaceState["stageColors"];
  setStageStatus: (stage: WorkStage, completed: boolean) => void;
}) {
  return <section className="stage-status-panel">
    <header><div><strong>阶段完成状态</strong><small>完成后续阶段会自动补齐前置；撤销后，该阶段及后续恢复待完成。</small></div></header>
    <div className="stage-status-track">{stageFlowFor(item.platform).map((stage) => {
      const completed = item.stage === "archived" || stageIndex(item.stage) > stageIndex(stage);
      const current = item.stage === stage;
      return <button
        key={stage}
        type="button"
        className={`${completed ? "completed" : "pending"} ${current ? "current" : ""}`}
        style={{ "--stage-color": stageColors[stage] } as React.CSSProperties}
        onClick={() => setStageStatus(stage, !completed)}
        aria-pressed={completed}
        title={completed ? `点击将${stageLabelFor(item.platform, stage)}及后续恢复为待完成` : `标记${stageLabelFor(item.platform, stage)}完成`}
      ><span>{completed ? "✓" : ""}</span><strong>{stageLabelFor(item.platform, stage)}</strong><em>{completed ? "已完成" : current ? "当前 · 待完成" : "待完成"}</em></button>;
    })}</div>
  </section>;
}

export function ContentDrawer({ item, initialTab, stageEvents, stageColors, contentTypes, scriptDraftIdOverride, onScriptDraftLinked, close, update, mergeScript, changeStage, setStageStatus, schedule, unschedule, remove, markPublished, unmarkPublished, saveReview, ruleDeposited, addRule, notify }: { item: ContentItem; initialTab: ContentDrawerTab; stageEvents: StageEvent[]; stageColors: WorkspaceState["stageColors"]; contentTypes: string[]; /** T2 六期修复轮 1: Cockpit.tsx 维护的同会话客户端覆盖表, 优先于 item.scriptDraftId (服务端字段, 只有下次 workspace GET 才会刷新) */ scriptDraftIdOverride?: string; onScriptDraftLinked?: (contentId: string, scriptDraftId: string) => void; close: () => void; update: (patch: Partial<ContentItem>) => void; mergeScript: (id: string, partial: Partial<ContentItem["script"]>) => void; changeStage: (stage: ContentStage) => void; setStageStatus: (stage: WorkStage, completed: boolean) => void; schedule: (stage: WorkStage, plannedDate: string) => void; unschedule: (stage: WorkStage) => void; remove: () => void; markPublished: () => void; unmarkPublished: () => void; saveReview: () => void; ruleDeposited: boolean; addRule: (text: string) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<ContentDrawerTab>(initialTab);
  const score = Object.values(item.topic.score).reduce((sum, value) => sum + value, 0);
  const updateTopic = (patch: Partial<ContentItem["topic"]>) => update({ topic: { ...item.topic, ...patch } });
  const updateScript = (patch: Partial<ContentItem["script"]>) => update({ script: { ...item.script, ...patch } });
  const updateMetrics = (key: keyof ContentItem["metrics"], value: number | string) => update({ metrics: { ...item.metrics, capturedAt: item.metrics.capturedAt || todayISO(), [key]: value } });
  const reviewPublished = item.publicationStatus === "published";
  const reviewStatus = !reviewPublished ? "unavailable" : item.review.completedAt ? "completed" : "pending";

  // ---- 抽屉内 AI 生成脚本（就地化，替代跳转 /agent） ----
  const [scriptPlatform, setScriptPlatform] = useState<ContentPlatform>(() => defaultScriptPlatform(item.platform));
  const [generating, setGenerating] = useState(false);
  const [titleHint, setTitleHint] = useState("");
  // ---- T7: 素材（可选）+ 时长 输入, 只有 douyin 消费, 其它平台生成时忽略 ----
  const [materials, setMaterials] = useState("");
  const [durationSec, setDurationSec] = useState<30 | 45 | 60>(45);
  // ---- T7: 本次生成响应里 douyin 特有的新字段 (scriptDraftId/sections/research)。
  // 六字段骨架 (item.script) 仍是唯一的持久化落点, 这些是纯前端展示/改稿用的
  // 派生 state, 不进 WorkspaceState。----
  const [scriptDraftId, setScriptDraftId] = useState<string | null>(null);
  const [sections, setSections] = useState<DouyinSection[] | null>(null);
  const [research, setResearch] = useState<ResearchBriefView | null>(null);
  const [researchDegraded, setResearchDegraded] = useState(false);
  const [hooks, setHooks] = useState<HookCandidate[]>([]);
  const [pickedHookIdx, setPickedHookIdx] = useState<number | null>(null);
  const [pickHookPending, setPickHookPending] = useState(false);
  const [allInstruction, setAllInstruction] = useState("");
  const [refiningAll, setRefiningAll] = useState(false);
  const [openSectionIdx, setOpenSectionIdx] = useState<number | null>(null);
  const [sectionInstruction, setSectionInstruction] = useState("");
  const [refiningSectionIdx, setRefiningSectionIdx] = useState<number | null>(null);
  // ---- T6 六期: xiaohongshu 两阶段生成的派生 state (与上面 douyin 专属的
  // sections/hooks 并列, 同一时刻只会有一组非空——scriptDraftId 是共享的单一
  // 判据)。intro/body 为 null 表示尚未生成/尚未恢复, XhsScriptPanel 只在两者
  // 都非 null 时渲染 (对应 draft-restore.ts parseDraftOutput 的 xhs 形态判据:
  // intro/body 都是非空字符串才算合法)。----
  const [xhsIntro, setXhsIntro] = useState<string | null>(null);
  const [xhsBody, setXhsBody] = useState<string | null>(null);
  const [xhsTags, setXhsTags] = useState<string[]>([]);
  const [xhsShotIdeas, setXhsShotIdeas] = useState<XhsShotIdea[]>([]);
  const [xhsInstruction, setXhsInstruction] = useState("");
  const [xhsRefining, setXhsRefining] = useState(false);
  // ---- T5 七期: 抽屉内配图生成的派生 state —— imagePlan 为 null 表示尚未点过
  // 「生成配图」/懒加载没恢复到已有计划; xhsImages 按 idx 索引已生成的图 (可能
  // 是 imagePlan 的子集, 逐张 POST、渐进渲染); failedImgIdxs 记录本次批量/单张
  // 重试中失败的 idx, 驱动对应缩略图格的「重试」按钮, 成功后从集合移除。
  // imgKeyMissingNotifiedRef 防止并发池 (2 个 worker) 同时命中 503 (未配置生图
  // key) 时重复弹两次相同的引导 toast——每次新的一批生成/单张重试开始前复位。
  const [imagePlan, setImagePlan] = useState<XhsImagePlanView | null>(null);
  const [xhsImages, setXhsImages] = useState<Record<number, XhsGeneratedImage>>({});
  const [imgGenerating, setImgGenerating] = useState(false);
  const [failedImgIdxs, setFailedImgIdxs] = useState<Set<number>>(new Set());
  const imgKeyMissingNotifiedRef = useRef(false);
  // T9 终审 + T6 六期扩展 + T5 七期扩展: 「用 AI 写脚本」按钮要跟
  // ScriptSectionsPanel 内部的 hook 候选切换/换一版/整体指令、XhsScriptPanel 的
  // 整稿指令、以及出图 (imgGenerating) 互斥——生成会整体替换
  // scriptDraftId/sections/intro/body, 这些动作在途时点生成、或生成在途时点
  // 这些动作, 都会打到同一草稿的并发写操作上; 出图虽然不改 intro/body, 但同样
  // 写同一条 ScriptDraft.output (imagePlan/images 键), 并发写有互相覆盖对方
  // spread 快照的风险, 一并纳入同一互斥开关。
  const scriptActionPending = refiningAll || refiningSectionIdx !== null || pickHookPending || xhsRefining || imgGenerating;
  const mountedRef = useRef(true);
  const currentItemIdRef = useRef(item.id);
  currentItemIdRef.current = item.id;
  // T9 终审修复波: 与 scriptDraftId state 同步维护的 ref —— 懒加载 effect 的
  // fetch 是异步的, await 期间用户可能已经点了「用 AI 写脚本」并通过
  // onGenerated 拿到了新草稿 (newDraftId), 但懒加载回调手里捕获的仍是 effect
  // 启动时的旧闭包, 感知不到这次并发写入。只在 state 上判断不够: state 的
  // 更新要等到下一次渲染才能被这个已经在跑的异步回调"看见", 而 ref 写入是
  // 同步的、对之后的任意时刻的读取立即可见。onGenerated / 懒加载两条写入
  // scriptDraftId 的路径都要同步维护这个 ref (reset 路径同理清空), 懒加载
  // 回调落笔前就近再查一次 ref (而不是只信任 effect 启动时的检查), 才能在
  // 「旧稿 GET 迟到」的场景下识别出本地已经有更新的草稿、放弃这次过期写入。
  const scriptDraftIdRef = useRef<string | null>(null);
  const titleFeedbackTimerRef = useRef<number | null>(null);
  const lastCheckedTitleRef = useRef("");
  // StrictMode 下 effect 会模拟 挂载→卸载→重新挂载, 若只在 cleanup 里把
  // mountedRef 设为 false 而没有对应的重新挂载动作把它设回 true, 这个 ref 在
  // 重新挂载后会永远停在 false —— 后续任何一次生成都会被 (误判为已卸载而)
  // 静默丢弃结果。effect 主体负责重新武装, cleanup 负责卸载时置 false。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (titleFeedbackTimerRef.current) window.clearTimeout(titleFeedbackTimerRef.current);
    };
  }, []);
  // T6 三期: `<ContentDrawer>` 的调用点 (Cockpit.tsx) 没有给它加 `key={item.id}`——
  // `openContent(id)` 可以在抽屉已经挂载时直接把 `selectedId` 从 A 切到 B (例如
  // AnalyticsView 的「复盘」入口), React 会复用同一个组件实例、只更新 `item` prop,
  // 不会触发 unmount/remount。若只靠上面的 `useState(() => ...)` 惰性初始值,
  // scriptPlatform 会停留在第一个打开的 item 的默认值上, 后续切换的 item 拿不到
  // 各自的默认平台。这里显式在 `item.id` 变化时重新计算默认值, 不依赖是否真的
  // 发生了 remount, 同时顺手清掉上一个 item 遗留的标题建议 (与 T2 二期的平台切换
  // 清 titleHint 是同一防陈旧套路)。
  useEffect(() => {
    setScriptPlatform(defaultScriptPlatform(item.platform));
    setTitleHint("");
    lastCheckedTitleRef.current = "";
    resetScriptGenerationState();
  }, [item.id, item.platform]);

  // T2 六期: 抽屉懒加载拉回改稿 UI —— item.script (六字段骨架) 关抽屉前已经持久化
  // 到 DB, 重开即可见; 但 sections/research/hooks 等只是抽屉自己的前端派生 state
  // (见上面 T7 注释), 之前每次挂载新 item / 切换 item 都会被上面那个 effect 的
  // resetScriptGenerationState() 清空, 抽屉重开后分块改稿面板 (ScriptSectionsPanel)
  // 消失、只剩六个文本框, 五期 spec §6(c) 描述的限制。
  //
  // effectiveScriptDraftId 优先取 scriptDraftIdOverride (Cockpit.tsx 维护的同会话
  // 客户端覆盖表, handleGenerateScript 生成成功时写入), 兜底 item.scriptDraftId
  // (T1 回写的服务端字段, server-store.ts 只读下发, 只有下次 GET
  // /api/v1/cockpit/workspace 才会刷新)。修复轮 1: 若只认 item.scriptDraftId,
  // 同一浏览器会话里「生成→关抽屉→立即重开」拿到的还是生成前那份 workspace 快照,
  // 恢复不了——因为 /api/v1/scripts/generate 的 linkCockpitContent 按 T1 设计
  // 特意不调 bumpCockpitRev (避免这种高频动作触发 409)。覆盖表让抽屉自己刚生成
  // 出来的 scriptDraftId 在同会话内立即可见, 不用等下一次整页刷新。
  //
  // 触发条件: 本地无生成态 (scriptDraftId state 仍是 null——上面 reset 效果刚清空,
  // 或本次是全新挂载) 且 effectiveScriptDraftId 非空。effect 依赖里带上本地
  // scriptDraftId: reset 效果与本 effect 在同一次 item.id 变化的 effect flush 里
  // 按声明顺序各自触发, 若 reset 效果确实把上一个 item 残留的非空 scriptDraftId
  // 清成 null, 这次 flush 里读到的仍是 React 还没应用的旧值——但那次 setState 会
  // 触发一次新的渲染, 本 effect 因为 scriptDraftId 出现在依赖数组里会跟着重新
  // 求值一次, 那时读到的就是清空后的 null, 不会漏拉取。
  //
  // 拉回失败/该草稿解析不出任何一种已知形状 (parseDraftOutput 既找不到合法
  // sections 也找不到合法 intro+body, 例如旧 retentionBeats 形态) 一律静默保持
  // 现状——不 notify、不阻断骨架文本框编辑 (没有额外的 loading 态去 disable
  // 任何输入)。T6 六期: parseDraftOutput 现在能解析出两种互斥形状——douyin
  // (`sections` 非空) 或 xiaohongshu (`intro`+`body` 都非空), 按 `parsed.sections`
  // 是否存在分流到对应的恢复分支, 两条分支都会写 scriptDraftId 触发面板渲染。
  const effectiveScriptDraftId = scriptDraftIdOverride ?? item.scriptDraftId ?? null;
  useEffect(() => {
    if (scriptDraftId || !effectiveScriptDraftId) return;
    const requestedItemId = item.id;
    const draftId = effectiveScriptDraftId;
    (async () => {
      try {
        const res = await fetch(`/api/v1/scripts/${draftId}`);
        const json = await res.json();
        if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
        if (!json.success) return;
        const parsed = parseDraftOutput(json.data?.output);
        if (!parsed) return;
        // 就近再检查: effect 启动时 (上面 `if (scriptDraftId || ...)`) 的判断只是
        // 一次性的准入门槛, 挡不住 await 期间 onGenerated 写入的新草稿——这里在
        // 真正落笔前用同步维护的 ref 再确认一次本地是否已经有更新的草稿, 有则
        // 放弃这次过期写入 (不 setState, 静默丢弃), 避免整体替换回旧稿。
        if (scriptDraftIdRef.current) return;
        const pickedHookIdx = (json.data?.picked as { hookIdx?: unknown } | undefined)?.hookIdx;
        if (parsed.sections) {
          setScriptDraftId(draftId);
          scriptDraftIdRef.current = draftId;
          setSections(parsed.sections);
          if (parsed.research) setResearch(parsed.research);
          if (parsed.hooks) setHooks(parsed.hooks);
          if (parsed.durationSec !== undefined) setDurationSec(parsed.durationSec);
          if (typeof pickedHookIdx === "number") setPickedHookIdx(pickedHookIdx);
        } else if (parsed.intro && parsed.body) {
          setScriptDraftId(draftId);
          scriptDraftIdRef.current = draftId;
          setXhsIntro(parsed.intro);
          setXhsBody(parsed.body);
          if (parsed.research) setResearch(parsed.research);
          if (parsed.tags) setXhsTags(parsed.tags);
          if (parsed.shotIdeas) setXhsShotIdeas(parsed.shotIdeas);
          // T5 七期: 出图计划/已生成配图同样是抽屉自己的前端派生 state, 懒加载
          // 重开时一并拉回——否则重开抽屉后缩略图网格和「打包下载」都会消失,
          // 即便 output.images 早已落库。
          if (parsed.imagePlan) setImagePlan(parsed.imagePlan);
          if (parsed.images) setXhsImages(parsed.images);
        }
      } catch {
        // 网络失败等: 静默保持现状, 不打扰用户
      }
    })();
  }, [item.id, effectiveScriptDraftId, scriptDraftId]);

  // T7: 上一个 item / 上一次生成留下的 sections/research/scriptDraftId 等派生
  // state 全部清空——切换 item 或手动改 scriptPlatform 下拉都要调用, 否则会把
  // A 内容的分块 UI 错误地叠在 B 内容上 (refine 接口按 scriptDraftId 定位, 不
  // 清空会拿旧 scriptDraftId 去改一篇看起来是新内容的稿子)。素材（可选）/时长
  // 输入不在此列——它们是本次生成的输入参数, 切换生成平台后仍可复用。
  function resetScriptGenerationState() {
    setScriptDraftId(null);
    scriptDraftIdRef.current = null;
    setSections(null);
    setResearch(null);
    setResearchDegraded(false);
    setHooks([]);
    setPickedHookIdx(null);
    setAllInstruction("");
    setOpenSectionIdx(null);
    setSectionInstruction("");
    setXhsIntro(null);
    setXhsBody(null);
    setXhsTags([]);
    setXhsShotIdeas([]);
    setXhsInstruction("");
    setImagePlan(null);
    setXhsImages({});
    setFailedImgIdxs(new Set());
  }

  async function handleGenerateScript() {
    // T9 终审 + T6 六期扩展 + T5 七期扩展: 生成本身也要跟 hook 候选切换/换一版/
    // 整体指令/xhs 整稿指令/出图五组动作互斥——生成会整体替换
    // scriptDraftId/sections/intro/body, 若在改稿/选 hook/出图请求在途时打断,
    // 迟到的响应可能覆盖掉新草稿, 或改稿/出图请求会打到已经不存在的旧草稿上。
    if (generating || refiningAll || refiningSectionIdx !== null || pickHookPending || xhsRefining || imgGenerating) return;
    await runGenerateScript(
      { itemId: item.id, title: item.title, platform: scriptPlatform, materials: scriptPlatform === "douyin" || scriptPlatform === "xiaohongshu" ? (materials.trim() || undefined) : undefined, durationSec: scriptPlatform === "douyin" ? durationSec : undefined, cockpitContentId: item.id },
      {
        // 不能直接把裸的 `fetch` 引用传下去: 原生 fetch 依赖 `this === window`
        // 的隐式绑定, 脱离 window 对象单独调用会抛 "Illegal invocation"。
        // wrap 成箭头函数, 调用点仍然是 `window.fetch(...)`。
        fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
        resolveDefaultNiche,
        mapGeneratedToScript,
        mergeScript,
        notify,
        setGenerating,
        isMounted: () => mountedRef.current,
        isCurrentItem: (id) => currentItemIdRef.current === id,
        onGenerated: (data) => {
          const newDraftId = typeof data.scriptDraftId === "string" ? data.scriptDraftId : null;
          setScriptDraftId(newDraftId);
          scriptDraftIdRef.current = newDraftId;
          setSections(parseSections(data.sections));
          setResearch(parseResearch(data.research));
          setResearchDegraded(Boolean(data.researchDegraded));
          setHooks(parseHooks(data.hooks));
          setPickedHookIdx(null);
          // T6 六期: xiaohongshu 分支响应带 intro/body/tags/shotIdeas, douyin
          // 分支响应没有这几个键——非字符串/非数组时各自落到 null/[] 兜底,
          // 与上面 sections/hooks 在跨平台切换时的清空行为保持一致。
          setXhsIntro(typeof data.intro === "string" && data.intro.length > 0 ? data.intro : null);
          setXhsBody(typeof data.body === "string" && data.body.length > 0 ? data.body : null);
          setXhsTags(parseXhsTags(data.tags));
          setXhsShotIdeas(parseXhsShotIdeas(data.shotIdeas));
          // T5 七期: 新生成的草稿是全新的 ScriptDraft (新 scriptDraftId), 旧稿的
          // 出图计划/已生成配图不再属于这条新草稿, 必须清空——否则会把上一篇
          // (或上一次生成前) 的缩略图错误地叠在这次新生成的图文笔记上。
          setImagePlan(null);
          setXhsImages({});
          setFailedImgIdxs(new Set());
          // 修复轮 1: 生成成功即把新 scriptDraftId 记进 Cockpit.tsx 的同会话覆盖表,
          // 让「关抽屉→立即重开」也能走上面的懒加载拉回效果——不用等下次整页刷新
          // 才能从 workspace GET 里看到 item.scriptDraftId。
          if (newDraftId) onScriptDraftLinked?.(item.id, newDraftId);
          // 十期: 生成响应新增 suggestedIntent —— 只在内容卡 intent 当前为空时自动回填
          // 并 notify 提示 (裁决: 非空时不覆盖用户已选择的意图, 尊重用户的手动标注)。
          if (!item.intent && isValidContentIntent(data.suggestedIntent)) {
            update({ intent: data.suggestedIntent });
            notify(`已按选题建议意图：${INTENT_LABELS[data.suggestedIntent]}`);
          }
        },
      },
    );
  }

  async function handlePickHook(hookIdx: number) {
    if (!scriptDraftId || pickHookPending || generating || refiningAll || refiningSectionIdx !== null || xhsRefining || imgGenerating) return;
    // 跨 item 竞态守卫: 请求发起时捕获目标 item, await 期间用户可能已切到另一篇
    // 内容 (resetScriptGenerationState 已清空 sections/scriptDraftId)——这条迟到
    // 的响应不该再把 A 内容的选定结果写进现在显示的 B 内容面板。过期直接丢弃,
    // 不 setState、不 notify。参考 generate-flow.ts 的 isMounted()/isCurrentItem() 先例。
    const requestedItemId = item.id;
    setPickHookPending(true);
    try {
      const res = await fetch(`/api/v1/scripts/${scriptDraftId}/picked`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hookIdx, reviewed: {} }),
      });
      const json = await res.json();
      if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
      if (json.success) {
        setPickedHookIdx(hookIdx);
      } else {
        notify(json.message || "选定失败");
      }
    } catch (e) {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        notify(e instanceof Error ? e.message : "选定失败，请稍后重试");
      }
    } finally {
      setPickHookPending(false);
    }
  }

  // 返回是否成功——两个调用点都只在成功时才清空自己的指令输入框, 失败要保留
  // 用户已经打好的指令原文, 方便直接改一改重试, 不用重新输入一遍。
  async function runRefine(body: { scope: "section"; sectionIdx: number; instruction: string } | { scope: "all"; instruction: string }): Promise<boolean> {
    if (!scriptDraftId) return false;
    // 跨 item 竞态守卫: 同 handlePickHook——改稿请求在途期间抽屉可能已切到另一篇
    // 内容, 迟到的响应不该覆盖现在显示的 (另一篇) 内容的段落, 也不该弹错误 toast
    // 打扰用户。静默丢弃, 不 setState、不 notify。
    const requestedItemId = item.id;
    const res = await fetch(`/api/v1/scripts/${scriptDraftId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return false;
    if (json.success) {
      const nextSections = json.data.sections as DouyinSection[];
      setSections(nextSections);
      mergeScript(item.id, sectionsToScriptFields(nextSections));
      return true;
    }
    // 502 (AI 越权改动) 与其余错误共用同一条展示路径 — 路由返回的 message 已经
    // 是「AI 修改了未指定的段落, 请重试」这类面向用户的完整文案。
    notify(json.message || "改写失败");
    return false;
  }

  async function handleRefineSection(idx: number) {
    const instruction = sectionInstruction.trim();
    if (!scriptDraftId || !instruction || refiningSectionIdx !== null || refiningAll || generating || pickHookPending || xhsRefining || imgGenerating) return;
    const requestedItemId = item.id;
    setRefiningSectionIdx(idx);
    try {
      const succeeded = await runRefine({ scope: "section", sectionIdx: idx, instruction });
      if (succeeded) {
        setOpenSectionIdx(null);
        setSectionInstruction("");
      }
    } catch (e) {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        notify(e instanceof Error ? e.message : "改写失败，请稍后重试");
      }
    } finally {
      setRefiningSectionIdx(null);
    }
  }

  async function handleRefineAll() {
    const instruction = allInstruction.trim();
    if (!scriptDraftId || !instruction || refiningAll || refiningSectionIdx !== null || generating || pickHookPending || xhsRefining || imgGenerating) return;
    const requestedItemId = item.id;
    setRefiningAll(true);
    try {
      const succeeded = await runRefine({ scope: "all", instruction });
      if (succeeded) setAllInstruction("");
    } catch (e) {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        notify(e instanceof Error ? e.message : "改写失败，请稍后重试");
      }
    } finally {
      setRefiningAll(false);
    }
  }

  /**
   * T6 六期: 小红书页顶整稿指令——只支持 scope:'all' (小红书不做分块改稿, 见
   * spec §2), 响应形状是 `{ intro, body }` (不是 douyin 的 `{ sections }`), 因此
   * 不复用上面的 `runRefine` (那个只认 sections 响应), 独立实现同款竞态守卫 +
   * 成功/失败路径。成功后本地替换 intro/body, 并按 `mapGeneratedToScript`
   * (xiaohongshu 分支即 mapXiaohongshu) 同款语义 intro→hook、body→body 回填
   * 六字段骨架——只传 { intro, body } 两键, mapXiaohongshu 对未出现的
   * titles/coverText/shotIdeas/tags 键不会产出对应字段, 不会误覆盖骨架里其它
   * 字段 (headline/conclusion/example/ending) 已有的用户内容。
   */
  async function handleRefineXhsAll() {
    const instruction = xhsInstruction.trim();
    if (!scriptDraftId || !instruction || xhsRefining || refiningAll || refiningSectionIdx !== null || generating || pickHookPending || imgGenerating) return;
    const requestedItemId = item.id;
    setXhsRefining(true);
    try {
      const res = await fetch(`/api/v1/scripts/${scriptDraftId}/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all", instruction }),
      });
      const json = await res.json();
      if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
      if (json.success) {
        const newIntro = json.data.intro as string;
        const newBody = json.data.body as string;
        setXhsIntro(newIntro);
        setXhsBody(newBody);
        mergeScript(item.id, mapGeneratedToScript("xiaohongshu", { intro: newIntro, body: newBody }));
        setXhsInstruction("");
      } else {
        notify(json.message || "改写失败");
      }
    } catch (e) {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        notify(e instanceof Error ? e.message : "改写失败，请稍后重试");
      }
    } finally {
      setXhsRefining(false);
    }
  }

  /**
   * T5 七期: 出图 —— 单张调用, 被批量生成 (handleGenerateImages 的并发池) 与
   * 单格重试 (handleRetryImage) 共用。成功: 写入 xhsImages[idx], 从
   * failedImgIdxs 移除该 idx (若在集合里)。失败: 503 (未配置 OpenAI 生图 key)
   * 走统一引导 toast (由 imgKeyMissingNotifiedRef 防重复弹出) 并返回 "no-key"
   * 让调用方中止批量池的后续张数 (同一草稿共用同一把 key, 继续逐张打只会
   * 拿到同样的 503, 纯粹浪费请求); 其余失败 (502 vendor 生成失败等) 只标记该
   * 格 failedImgIdxs, 驱动该格「重试」按钮, 不弹全局 toast (避免批量生成时
   * 多张失败连环弹窗打扰)。
   *
   * 跨 item 竞态守卫: 与 handlePickHook/runRefine 同款——await 期间抽屉可能
   * 已切到另一篇内容, 迟到的响应不该再写进现在显示的 (另一篇) 内容面板,
   * 也不该占用 failedImgIdxs 展示重试按钮。
   */
  async function generateOneImage(draftId: string, requestedItemId: string, idx: number): Promise<"ok" | "failed" | "no-key"> {
    try {
      const res = await fetch(`/api/v1/scripts/${draftId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idx }),
      });
      const json = await res.json().catch(() => null);
      if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return "failed";
      if (json?.success && typeof json.data?.path === "string") {
        const path = json.data.path as string;
        setXhsImages((prev) => ({ ...prev, [idx]: { path, prompt: "", createdAt: new Date().toISOString() } }));
        setFailedImgIdxs((prev) => {
          if (!prev.has(idx)) return prev;
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
        return "ok";
      }
      if (res.status === 503) {
        if (!imgKeyMissingNotifiedRef.current) {
          imgKeyMissingNotifiedRef.current = true;
          notify(`${json?.message || "未配置 OpenAI 生图 key"}，请前往「设置 → AI 服务配置」保存后重试`);
        }
        return "no-key";
      }
      setFailedImgIdxs((prev) => new Set(prev).add(idx));
      return "failed";
    } catch {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        setFailedImgIdxs((prev) => new Set(prev).add(idx));
      }
      return "failed";
    }
  }

  /** 并发 2 的简单 worker 池——任一 worker 拿到 "no-key" 就置 aborted, 两个
   * worker 各自在下一轮 while 判断时退出, 不再耗时打剩余张数。 */
  async function runImagePool(draftId: string, requestedItemId: string, targets: number[]) {
    let cursor = 0;
    let aborted = false;
    async function worker() {
      while (!aborted && cursor < targets.length) {
        if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
        const idx = targets[cursor++];
        const outcome = await generateOneImage(draftId, requestedItemId, idx);
        if (outcome === "no-key") aborted = true;
      }
    }
    await Promise.all([worker(), worker()]);
  }

  /**
   * 「生成配图」—— 按钮常亮 (无 key 时不做前置探测, 点击后端 503 才引导, 见简报
   * 裁决)。无本地 imagePlan 先幂等 POST plan (已有计划直接返回, 不重复调 LLM);
   * 拿到计划后并发 2 逐张生成尚未成功的 idx (已成图的跳过, 支持"部分张失败→
   * 重新点生成配图→只补齐失败的那些")。
   */
  async function handleGenerateImages() {
    if (!scriptDraftId || imgGenerating || generating || refiningAll || refiningSectionIdx !== null || pickHookPending || xhsRefining) return;
    const requestedItemId = item.id;
    const draftId = scriptDraftId;
    imgKeyMissingNotifiedRef.current = false;
    setImgGenerating(true);
    try {
      let plan = imagePlan;
      if (!plan) {
        const res = await fetch(`/api/v1/scripts/${draftId}/images/plan`, { method: "POST" });
        const json = await res.json().catch(() => null);
        if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
        if (!json?.success) {
          if (res.status === 503) {
            notify(`${json?.message || "未配置生成配图所需的 API Key"}，请前往「设置 → AI 服务配置」保存后重试`);
          } else {
            notify(json?.message || "出图计划生成失败");
          }
          return;
        }
        plan = parseXhsImagePlan(json.data?.plan);
        if (!plan) {
          notify("出图计划解析失败，请重试");
          return;
        }
        setImagePlan(plan);
      }
      const targets = plan.images.map((img) => img.idx).filter((idx) => !(idx in xhsImages));
      if (targets.length === 0) return;
      await runImagePool(draftId, requestedItemId, targets);
    } catch (e) {
      if (mountedRef.current && currentItemIdRef.current === requestedItemId) {
        notify(e instanceof Error ? e.message : "生成配图失败，请稍后重试");
      }
    } finally {
      // 与 runGenerateScript/handlePickHook 等既有 handler 同一约定: pending 复位
      // 无条件执行, 不依赖 isMounted/isCurrentItem——卡在"生成中…"比一次多余的
      // no-op setState (React 18 对已卸载组件调用 setState 是安全的) 更糟。
      setImgGenerating(false);
    }
  }

  /** 单格「重试」—— 复用 generateOneImage, 与批量生成共用同一个 imgGenerating
   * pending 开关 (简化互斥: 批量在跑时所有格的重试按钮也一并 disabled)。 */
  async function handleRetryImage(idx: number) {
    if (!scriptDraftId || imgGenerating || generating || refiningAll || refiningSectionIdx !== null || pickHookPending || xhsRefining) return;
    const requestedItemId = item.id;
    const draftId = scriptDraftId;
    imgKeyMissingNotifiedRef.current = false;
    setImgGenerating(true);
    try {
      await generateOneImage(draftId, requestedItemId, idx);
    } finally {
      setImgGenerating(false);
    }
  }

  function handleHeadlineBlur() {
    const value = item.script.headline.trim();
    if (titleFeedbackTimerRef.current) window.clearTimeout(titleFeedbackTimerRef.current);
    if (value.length < 3 || value === lastCheckedTitleRef.current) return;
    const requestedItemId = item.id;
    titleFeedbackTimerRef.current = window.setTimeout(async () => {
      lastCheckedTitleRef.current = value;
      try {
        const niche = await resolveDefaultNiche();
        const res = await fetch("/api/v1/checklist/title-feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: value, niche, platform: scriptPlatform }),
        });
        const json = await res.json();
        if (!mountedRef.current || currentItemIdRef.current !== requestedItemId) return;
        const suggestion = json.success && Array.isArray(json.data?.suggestions) ? json.data.suggestions[0] : null;
        if (typeof suggestion === "string" && suggestion) setTitleHint(suggestion);
      } catch {
        // 静默失败, 不打扰用户
      }
    }, 1500);
  }
  // 九期: 抽屉 tab 与阶段的对应——每个非 overview tab 都映射到一个具体 WorkStage,
  // 不在该内容平台流内的阶段 (xhs 的 recording/editing) 直接从 tab 栏隐藏, 与看板
  // 列/档期可排阶段的隐藏方式一致。ContentDrawer 没有 `key={item.id}`, 组件实例
  // 可能在抽屉不关闭的情况下从一个 item 直接切到另一个 item (见上面 T6 三期注释),
  // `tab` state 不会跟着重置——若上一个 item 停留在「录制」tab、切到 xhs 内容,
  // 该 tab 已经不在 visibleTabs 里, activeTab 兜底回 overview, 不渲染孤儿内容。
  const TAB_STAGE: Partial<Record<ContentDrawerTab, WorkStage>> = { topic: "topic", script: "script", recording: "recording", editing: "editing", publish: "publishing", review: "review" };
  const TAB_LABEL: Record<ContentDrawerTab, string> = { overview: "概览", topic: "大纲", script: stageLabelFor(item.platform, "script"), recording: "录制", editing: "剪辑", publish: "发布", review: "复盘" };
  const visibleTabs = (["overview", "topic", "script", "recording", "editing", "publish", "review"] as const).filter((value) => {
    const stage = TAB_STAGE[value];
    return !stage || isStageInFlow(item.platform, stage);
  });
  const activeTab: ContentDrawerTab = visibleTabs.includes(tab) ? tab : "overview";
  return <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) close(); }}><aside className="drawer" aria-label="内容详情"><header className="drawer-header"><div><div className="drawer-badges"><Badge tone={item.stage} color={stageColors[item.stage]}>{stageLabelFor(item.platform, item.stage)}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></div><input className="drawer-title" value={item.title} onChange={(e) => update({ title: e.target.value })} /></div><button className="close-button" onClick={close} aria-label="关闭">×</button></header><div className="drawer-tabs">{visibleTabs.map((value) => <button key={value} className={activeTab === value ? "active" : ""} onClick={() => setTab(value)}>{TAB_LABEL[value]}</button>)}</div><div className="drawer-body">
    {/* 九期: 「全局当前阶段」下拉是数据层的手动逃生舱——刻意保留 CONTENT_STAGES
        全 8 阶段超集 (含平台流外的值), 不走 stageLabelFor, 允许把内容手动改到
        任意原始阶段值 (含脏值/纠错场景)。其余显示态文案仍走 stageLabelFor。 */}
    {activeTab === "overview" ? <div className="drawer-section"><StageStatusPanel item={item} stageColors={stageColors} setStageStatus={setStageStatus} /><div className="form-grid"><label className="field"><span>全局当前阶段</span><select value={item.stage} onChange={(e) => changeStage(e.target.value as ContentStage)}>{Object.entries(STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>修改后会同步到内容总览和 Todo。</small></label><label className="field"><span>内容档位</span><select value={item.tier} onChange={(e) => update({ tier: e.target.value as ContentItem["tier"] })}><option value="C">C档快发</option><option value="B">B档常规</option><option value="A">A档精品</option></select></label><label className="field"><span>主要类型</span><select value={item.contentType} onChange={(e) => update({ contentType: e.target.value })}>{contentTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span>优先级</span><select value={item.priority} onChange={(e) => update({ priority: e.target.value as ContentItem["priority"] })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select></label><label className="field"><span>内容意图</span><select value={item.intent} onChange={(e) => update({ intent: e.target.value as ContentIntent })}><option value="">未标注</option>{CONTENT_INTENTS.map((value) => <option key={value} value={value}>{INTENT_LABELS[value]}</option>)}</select><small>引流 / 建立信任 / 转化——看板顶部按此统计内容组合比例。</small></label></div>{SCHEDULABLE_STAGES.includes(item.stage as WorkStage) ? <StageScheduleField item={item} stage={item.stage as WorkStage} stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} label="当前阶段计划完成" /> : item.stage === "inbox" ? <p className="stage-no-schedule-note">灵感只用于收集，不需要设置完成日期；进入大纲后再开始排期。</p> : item.stage === "review" ? <p className="stage-no-schedule-note">单篇内容不再安排复盘日期；可以在档期规划中放置统一的“复盘日”。</p> : null}<label className="field full"><span>原始 idea</span><textarea value={item.idea} onChange={(e) => update({ idea: e.target.value })} /></label><label className="field full"><span>标签（用顿号分隔）</span><input value={item.tags.join("、")} onChange={(e) => update({ tags: e.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean) })} /></label><div className="next-action-card"><span>下一步动作</span><strong>{nextActionFor(item.platform, item.stage)}</strong><p>上次更新：{item.updatedAt}</p></div></div> : null}
    {/* “AI 体检”按钮（调 /api/ai/analyze）已在 Task 14 移除：该路由未移植，AI 相关能力统一走 /agent。 */}
    {activeTab === "topic" ? <div className="drawer-section"><div className="section-title-row"><div><span className="eyebrow">TOPIC GATE</span><h3>大纲卡</h3></div></div><StageScheduleField item={item} stage="topic" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} />{[["目标受众", "audience"], ["具体痛点", "painPoint"], ["一句话观点", "pointOfView"], ["大家通常怎么讲", "commonAngle"], ["我的反差角度", "contrastAngle"], ["可展示素材", "assets"], ["最低成本拍法", "minimumProduction"]].map(([label, key]) => <label key={key} className="field full"><span>{label}</span><textarea value={String(item.topic[key as keyof typeof item.topic] ?? "")} onChange={(e) => updateTopic({ [key]: e.target.value })} /></label>)}<div className="score-card"><div><span>六维总分</span><strong>{score}<small> / 30</small></strong></div><div className="score-grid">{Object.entries({ audience: "受众", pain: "痛点", scene: "场景", demonstrable: "可展示", distribution: "传播", efficiency: "性价比" }).map(([key, label]) => <label key={key}><span>{label}</span><input type="range" min="0" max="5" value={item.topic.score[key as keyof typeof item.topic.score]} onChange={(e) => updateTopic({ score: { ...item.topic.score, [key]: Number(e.target.value) } })} /><strong>{item.topic.score[key as keyof typeof item.topic.score]}</strong></label>)}</div></div></div> : null}
    {/* “AI 质检”按钮（调 /api/ai/analyze）已在 Task 14 移除：该路由未移植；“用 AI 写脚本”自 Task 2 起改为抽屉内就地生成，不再跳转 /agent。 */}
    {activeTab === "script" ? <div className="drawer-section"><div className="section-title-row"><div><span className="eyebrow">SCRIPT</span><h3>先搭结构，再改措辞</h3></div></div>{!isContentPlatform(item.platform) ? <small className="field-hint">该平台暂不支持 AI 生成，可选相近平台生成后手动调整</small> : null}{scriptPlatform === "douyin" ? <div className="script-generate-options"><details className="script-materials-details"><summary>素材（可选）</summary><textarea value={materials} onChange={(e) => setMaterials(e.target.value)} disabled={generating} placeholder="粘贴素材原文、参考链接或要点，生成时会尝试真实引用进正文" /></details><label className="field script-duration-field"><span>时长</span><select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) as 30 | 45 | 60)} disabled={generating} aria-label="视频时长">{[30, 45, 60].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label></div> : scriptPlatform === "xiaohongshu" ? <div className="script-generate-options single"><details className="script-materials-details"><summary>素材（可选）</summary><textarea value={materials} onChange={(e) => setMaterials(e.target.value)} disabled={generating} placeholder="粘贴素材原文、参考链接或要点，生成时会尝试真实引用进正文" /></details></div> : null}<div className="script-generate-actions"><select value={scriptPlatform} onChange={(e) => { setScriptPlatform(e.target.value as ContentPlatform); setTitleHint(""); lastCheckedTitleRef.current = ""; resetScriptGenerationState(); }} disabled={generating || scriptActionPending} aria-label="生成平台" style={{ height: 34, borderRadius: 9 }}>{CONTENT_PLATFORMS.map((value) => <option key={value} value={value}>{CONTENT_PLATFORM_LABEL[value]}</option>)}</select><button type="button" className="ai-button small" disabled={generating || scriptActionPending} onClick={handleGenerateScript}><Icon name="spark" />{generating ? "生成中…" : "用 AI 写脚本"}</button></div><StageScheduleField item={item} stage="script" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} />{sections ? <ScriptSectionsPanel sections={sections} research={research} researchDegraded={researchDegraded} hooks={hooks} pickedHookIdx={pickedHookIdx} hookPending={pickHookPending} onPickHook={handlePickHook} allInstruction={allInstruction} onAllInstructionChange={setAllInstruction} onRefineAll={handleRefineAll} refiningAll={refiningAll} openSectionIdx={openSectionIdx} onToggleSection={(idx) => { setOpenSectionIdx(openSectionIdx === idx ? null : idx); setSectionInstruction(""); }} sectionInstruction={sectionInstruction} onSectionInstructionChange={setSectionInstruction} onRefineSection={handleRefineSection} refiningSectionIdx={refiningSectionIdx} generating={generating} imgGenerating={imgGenerating} /> : xhsIntro !== null && xhsBody !== null ? <XhsScriptPanel research={research} researchDegraded={researchDegraded} intro={xhsIntro} body={xhsBody} tags={xhsTags} shotIdeas={xhsShotIdeas} instruction={xhsInstruction} onInstructionChange={setXhsInstruction} onRefineAll={handleRefineXhsAll} refining={xhsRefining} generating={generating} imagePlan={imagePlan} images={xhsImages} imgGenerating={imgGenerating} failedImageIdxs={failedImgIdxs} onGenerateImages={handleGenerateImages} onRetryImage={handleRetryImage} archiveHref={scriptDraftId ? `/api/v1/scripts/${scriptDraftId}/images/archive` : null} /> : null}{[["标题方向", "headline"], ["开头 3 秒", "hook"], ["一句话结论", "conclusion"], ["内容结构", "body"], ["案例 / 演示", "example"], ["结尾行动 / 观点", "ending"]].map(([label, key]) => <label key={key} className="field full"><span>{label}</span><textarea className={key === "body" ? "large" : ""} value={item.script[key as keyof typeof item.script]} onChange={(e) => updateScript({ [key]: e.target.value })} onBlur={key === "headline" ? handleHeadlineBlur : undefined} />{key === "headline" && titleHint ? <small className="field-hint">{titleHint}</small> : null}</label>)}</div> : null}
    {activeTab === "recording" ? <div className="drawer-section"><div className="stage-detail-strip"><span>录制阶段</span><Badge tone="recording" color={stageColors.recording}>录制</Badge><small>完成后进入剪辑</small></div><StageScheduleField item={item} stage="recording" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} /><label className="field full"><span>录制备注</span><textarea className="large" value={item.recordingNotes} onChange={(e) => update({ recordingNotes: e.target.value })} placeholder="记录机位、口播、录屏、演示路径和补拍素材…" /></label><div className="checklist"><strong>录制完成清单</strong>{["机位与画面可用", "收音清晰", "口播或演示路径完整", "必要素材与补拍镜头齐全"].map((text) => <label key={text}><input type="checkbox" />{text}</label>)}</div></div> : null}
    {activeTab === "editing" ? <div className="drawer-section"><div className="stage-detail-strip"><span>剪辑阶段</span><Badge tone="editing" color={stageColors.editing}>剪辑</Badge><small>完成后进入发布</small></div><StageScheduleField item={item} stage="editing" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} /><label className="field full"><span>剪辑备注</span><textarea className="large" value={item.editingNotes} onChange={(e) => update({ editingNotes: e.target.value })} placeholder="记录结构删改、字幕、包装、素材替换和导出要求…" /></label><div className="checklist"><strong>剪辑完成清单</strong>{["开头 5 秒直接进入场景", "案例或演示重点清楚", "字幕清楚可读", "封面与标题已确认", `${item.tier}档制作投入已控制`].map((text) => <label key={text}><input type="checkbox" />{text}</label>)}</div></div> : null}
    {activeTab === "publish" ? <div className="drawer-section"><StageScheduleField item={item} stage="publishing" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} label="计划发布日期" /><div className="form-grid"><label className="field"><span>发布状态</span><select value={item.publicationStatus} disabled><option value="draft">未排期</option><option value="scheduled">已排期</option><option value="published">已发布</option></select><small>由发布档期和实际发布记录自动更新。</small></label><label className="field"><span>实际发布时间</span><input type="date" value={item.publishedAt} onChange={(e) => update({ publishedAt: e.target.value })} /></label></div><label className="field full"><span>封面文案</span><input value={item.coverCopy} onChange={(e) => update({ coverCopy: e.target.value })} /></label><label className="field full"><span>发布正文</span><textarea className="large" value={item.publishCopy} onChange={(e) => update({ publishCopy: e.target.value })} /></label><label className="field full"><span>小红书链接</span><input value={item.xhsLink} onChange={(e) => update({ xhsLink: e.target.value })} placeholder="https://www.xiaohongshu.com/..." /></label>{item.publicationStatus !== "published" ? <><button className="primary-button full-button" disabled={!item.publishedAt} onClick={markPublished}>标记为已发布</button>{!item.publishedAt ? <p className="validation-note">先填写实际发布时间，系统才会计入大目标。</p> : null}</> : <div className="published-banner"><span>已发布于 {item.publishedAt} · 已进入待复盘列表</span><button onClick={unmarkPublished}>撤销发布记录</button></div>}</div> : null}
    {activeTab === "review" ? <div className="drawer-section review-drawer-section"><div className="section-title-row"><div><span className="eyebrow">T+3 REVIEW</span><h3>给这篇内容定型</h3></div><span className={`review-state-badge ${reviewStatus}`}>{reviewStatus === "completed" ? "已复盘" : reviewStatus === "pending" ? "待复盘" : "尚未发布"}</span></div><p className="stage-no-schedule-note">单篇内容不设置复盘档期；请在统一的“复盘日”集中处理待复盘内容。</p><section className="review-block"><header><span>01</span><div><strong>数据快照</strong><small>记录发布后的真实表现</small></div></header><div className="metrics-grid">{[["播放", "views"], ["点赞", "likes"], ["收藏", "saves"], ["评论", "comments"], ["涨粉", "followerGain"]].map(([label, key]) => <label key={key}><span>{label}</span><input type="number" min="0" value={item.metrics[key as keyof typeof item.metrics] as number} onChange={(e) => updateMetrics(key as keyof ContentItem["metrics"], Number(e.target.value))} /></label>)}</div><label className="field full"><span>数据快照日期</span><input type="date" value={item.metrics.capturedAt} onChange={(e) => updateMetrics("capturedAt", e.target.value)} /><small>建议在发布后第 3 天录入，便于横向比较内容表现。</small></label></section><section className="review-block review-rating-block"><header><span>02</span><div><strong>定型评价</strong><small>这篇内容最终值几颗星？</small></div></header><StarRating value={item.review.rating} onChange={(rating) => update({ review: { ...item.review, rating } })} /></section><section className="review-block"><header><span>03</span><div><strong>复盘分析</strong><small>写下为什么，以及下一条要怎么做</small></div></header><label className="field full"><textarea className="review-analysis-input" value={item.review.analysis} onChange={(e) => update({ review: { ...item.review, analysis: e.target.value } })} placeholder="例如：具体场景带来了高收藏，但开头进入主题太慢；下一条先展示结果，再解释过程。" /></label></section><section className="review-block review-rule-compose"><header><span>04</span><div><strong>这次学到的规则</strong><small>提炼成以后可以重复使用的一句话</small></div></header><label className="field full"><textarea value={item.review.learnedRule} onChange={(e) => update({ review: { ...item.review, learnedRule: e.target.value } })} placeholder="例如：讲工作流时，先展示最终工作台，再解释每一步。" /></label><button className="secondary-button full-button" disabled={!item.review.learnedRule.trim() || ruleDeposited} onClick={() => addRule(item.review.learnedRule)}>{ruleDeposited ? "已沉淀为内容规则" : "沉淀为内容规则"}</button></section><div className={`review-save-bar ${item.review.completedAt ? "completed" : ""}`}><div><strong>{!reviewPublished ? "发布后才能保存复盘" : item.review.completedAt ? "这篇内容已完成复盘" : "完成后再保存复盘"}</strong><small>{!reviewPublished ? "发布后会自动进入待复盘列表。" : item.review.completedAt ? `上次保存：${item.review.completedAt.slice(0, 10)}，仍可修改后更新。` : "至少需要完成星级评价和复盘分析。"}</small></div><button className="primary-button" disabled={!reviewPublished || !item.review.rating || !item.review.analysis.trim()} onClick={saveReview}>{item.review.completedAt ? "更新复盘" : "保存复盘"}</button></div></div> : null}
    <div className="drawer-footer-action"><small>永久操作，删除后无法恢复</small><button type="button" className="delete-content-button" onClick={remove}>删除此内容</button></div>
  </div></aside></div>;
}
