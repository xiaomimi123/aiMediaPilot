"use client";

import { useEffect, useRef, useState } from "react";
import {
  NEXT_ACTIONS,
  SCHEDULABLE_STAGES,
  STAGE_LABELS,
  WORK_STAGES,
  type ContentItem,
  type ContentStage,
  type StageEvent,
  type WorkStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { todayISO } from "@/lib/cockpit/calculations";
import { stageIndex } from "@/lib/cockpit/workflow";
import { mapGeneratedToScript } from "@/lib/cockpit/script-mapping";
import { runGenerateScript } from "@/lib/cockpit/generate-flow";
import { CONTENT_PLATFORMS, CONTENT_PLATFORM_LABEL, type ContentPlatform } from "@/lib/platform";
import { Badge, Icon, StarRating } from "./shared";

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
    <input type="date" value={event?.plannedDate ?? ""} disabled={historical} onChange={(changeEvent) => changeEvent.target.value ? schedule(stage, changeEvent.target.value) : unschedule(stage)} aria-label={`${STAGE_LABELS[stage]}${label}`} />
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
    <div className="stage-status-track">{WORK_STAGES.map((stage) => {
      const completed = item.stage === "archived" || stageIndex(item.stage) > stageIndex(stage);
      const current = item.stage === stage;
      return <button
        key={stage}
        type="button"
        className={`${completed ? "completed" : "pending"} ${current ? "current" : ""}`}
        style={{ "--stage-color": stageColors[stage] } as React.CSSProperties}
        onClick={() => setStageStatus(stage, !completed)}
        aria-pressed={completed}
        title={completed ? `点击将${STAGE_LABELS[stage]}及后续恢复为待完成` : `标记${STAGE_LABELS[stage]}完成`}
      ><span>{completed ? "✓" : ""}</span><strong>{STAGE_LABELS[stage]}</strong><em>{completed ? "已完成" : current ? "当前 · 待完成" : "待完成"}</em></button>;
    })}</div>
  </section>;
}

export function ContentDrawer({ item, initialTab, stageEvents, stageColors, contentTypes, close, update, mergeScript, changeStage, setStageStatus, schedule, unschedule, remove, markPublished, unmarkPublished, saveReview, ruleDeposited, addRule, notify }: { item: ContentItem; initialTab: ContentDrawerTab; stageEvents: StageEvent[]; stageColors: WorkspaceState["stageColors"]; contentTypes: string[]; close: () => void; update: (patch: Partial<ContentItem>) => void; mergeScript: (id: string, partial: Partial<ContentItem["script"]>) => void; changeStage: (stage: ContentStage) => void; setStageStatus: (stage: WorkStage, completed: boolean) => void; schedule: (stage: WorkStage, plannedDate: string) => void; unschedule: (stage: WorkStage) => void; remove: () => void; markPublished: () => void; unmarkPublished: () => void; saveReview: () => void; ruleDeposited: boolean; addRule: (text: string) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<ContentDrawerTab>(initialTab);
  const score = Object.values(item.topic.score).reduce((sum, value) => sum + value, 0);
  const updateTopic = (patch: Partial<ContentItem["topic"]>) => update({ topic: { ...item.topic, ...patch } });
  const updateScript = (patch: Partial<ContentItem["script"]>) => update({ script: { ...item.script, ...patch } });
  const updateMetrics = (key: keyof ContentItem["metrics"], value: number | string) => update({ metrics: { ...item.metrics, capturedAt: item.metrics.capturedAt || todayISO(), [key]: value } });
  const reviewPublished = item.publicationStatus === "published";
  const reviewStatus = !reviewPublished ? "unavailable" : item.review.completedAt ? "completed" : "pending";

  // ---- 抽屉内 AI 生成脚本（就地化，替代跳转 /agent） ----
  const [scriptPlatform, setScriptPlatform] = useState<ContentPlatform>("douyin");
  const [generating, setGenerating] = useState(false);
  const [titleHint, setTitleHint] = useState("");
  const mountedRef = useRef(true);
  const currentItemIdRef = useRef(item.id);
  currentItemIdRef.current = item.id;
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

  async function handleGenerateScript() {
    if (generating) return;
    await runGenerateScript(
      { itemId: item.id, title: item.title, platform: scriptPlatform },
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
      },
    );
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
  return <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) close(); }}><aside className="drawer" aria-label="内容详情"><header className="drawer-header"><div><div className="drawer-badges"><Badge tone={item.stage} color={stageColors[item.stage]}>{STAGE_LABELS[item.stage]}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></div><input className="drawer-title" value={item.title} onChange={(e) => update({ title: e.target.value })} /></div><button className="close-button" onClick={close} aria-label="关闭">×</button></header><div className="drawer-tabs">{(["overview", "topic", "script", "recording", "editing", "publish", "review"] as const).map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{({ overview: "概览", topic: "大纲", script: "脚本", recording: "录制", editing: "剪辑", publish: "发布", review: "复盘" })[value]}</button>)}</div><div className="drawer-body">
    {tab === "overview" ? <div className="drawer-section"><StageStatusPanel item={item} stageColors={stageColors} setStageStatus={setStageStatus} /><div className="form-grid"><label className="field"><span>全局当前阶段</span><select value={item.stage} onChange={(e) => changeStage(e.target.value as ContentStage)}>{Object.entries(STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>修改后会同步到内容总览和 Todo。</small></label><label className="field"><span>内容档位</span><select value={item.tier} onChange={(e) => update({ tier: e.target.value as ContentItem["tier"] })}><option value="C">C档快发</option><option value="B">B档常规</option><option value="A">A档精品</option></select></label><label className="field"><span>主要类型</span><select value={item.contentType} onChange={(e) => update({ contentType: e.target.value })}>{contentTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span>优先级</span><select value={item.priority} onChange={(e) => update({ priority: e.target.value as ContentItem["priority"] })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select></label></div>{SCHEDULABLE_STAGES.includes(item.stage as WorkStage) ? <StageScheduleField item={item} stage={item.stage as WorkStage} stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} label="当前阶段计划完成" /> : item.stage === "inbox" ? <p className="stage-no-schedule-note">灵感只用于收集，不需要设置完成日期；进入大纲后再开始排期。</p> : item.stage === "review" ? <p className="stage-no-schedule-note">单篇内容不再安排复盘日期；可以在档期规划中放置统一的“复盘日”。</p> : null}<label className="field full"><span>原始 idea</span><textarea value={item.idea} onChange={(e) => update({ idea: e.target.value })} /></label><label className="field full"><span>标签（用顿号分隔）</span><input value={item.tags.join("、")} onChange={(e) => update({ tags: e.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean) })} /></label><div className="next-action-card"><span>下一步动作</span><strong>{NEXT_ACTIONS[item.stage]}</strong><p>上次更新：{item.updatedAt}</p></div></div> : null}
    {/* “AI 体检”按钮（调 /api/ai/analyze）已在 Task 14 移除：该路由未移植，AI 相关能力统一走 /agent。 */}
    {tab === "topic" ? <div className="drawer-section"><div className="section-title-row"><div><span className="eyebrow">TOPIC GATE</span><h3>大纲卡</h3></div></div><StageScheduleField item={item} stage="topic" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} />{[["目标受众", "audience"], ["具体痛点", "painPoint"], ["一句话观点", "pointOfView"], ["大家通常怎么讲", "commonAngle"], ["我的反差角度", "contrastAngle"], ["可展示素材", "assets"], ["最低成本拍法", "minimumProduction"]].map(([label, key]) => <label key={key} className="field full"><span>{label}</span><textarea value={String(item.topic[key as keyof typeof item.topic] ?? "")} onChange={(e) => updateTopic({ [key]: e.target.value })} /></label>)}<div className="score-card"><div><span>六维总分</span><strong>{score}<small> / 30</small></strong></div><div className="score-grid">{Object.entries({ audience: "受众", pain: "痛点", scene: "场景", demonstrable: "可展示", distribution: "传播", efficiency: "性价比" }).map(([key, label]) => <label key={key}><span>{label}</span><input type="range" min="0" max="5" value={item.topic.score[key as keyof typeof item.topic.score]} onChange={(e) => updateTopic({ score: { ...item.topic.score, [key]: Number(e.target.value) } })} /><strong>{item.topic.score[key as keyof typeof item.topic.score]}</strong></label>)}</div></div></div> : null}
    {/* “AI 质检”按钮（调 /api/ai/analyze）已在 Task 14 移除：该路由未移植；“用 AI 写脚本”自 Task 2 起改为抽屉内就地生成，不再跳转 /agent。 */}
    {tab === "script" ? <div className="drawer-section"><div className="section-title-row"><div><span className="eyebrow">SCRIPT</span><h3>先搭结构，再改措辞</h3></div><div style={{ display: "flex", gap: 8 }}><select value={scriptPlatform} onChange={(e) => { setScriptPlatform(e.target.value as ContentPlatform); setTitleHint(""); lastCheckedTitleRef.current = ""; }} disabled={generating} aria-label="生成平台" style={{ height: 34, borderRadius: 9 }}>{CONTENT_PLATFORMS.map((value) => <option key={value} value={value}>{CONTENT_PLATFORM_LABEL[value]}</option>)}</select><button type="button" className="ai-button small" disabled={generating} onClick={handleGenerateScript}><Icon name="spark" />{generating ? "生成中…" : "用 AI 写脚本"}</button></div></div><StageScheduleField item={item} stage="script" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} />{[["标题方向", "headline"], ["开头 3 秒", "hook"], ["一句话结论", "conclusion"], ["内容结构", "body"], ["案例 / 演示", "example"], ["结尾行动 / 观点", "ending"]].map(([label, key]) => <label key={key} className="field full"><span>{label}</span><textarea className={key === "body" ? "large" : ""} value={item.script[key as keyof typeof item.script]} onChange={(e) => updateScript({ [key]: e.target.value })} onBlur={key === "headline" ? handleHeadlineBlur : undefined} />{key === "headline" && titleHint ? <small className="field-hint">{titleHint}</small> : null}</label>)}</div> : null}
    {tab === "recording" ? <div className="drawer-section"><div className="stage-detail-strip"><span>录制阶段</span><Badge tone="recording" color={stageColors.recording}>录制</Badge><small>完成后进入剪辑</small></div><StageScheduleField item={item} stage="recording" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} /><label className="field full"><span>录制备注</span><textarea className="large" value={item.recordingNotes} onChange={(e) => update({ recordingNotes: e.target.value })} placeholder="记录机位、口播、录屏、演示路径和补拍素材…" /></label><div className="checklist"><strong>录制完成清单</strong>{["机位与画面可用", "收音清晰", "口播或演示路径完整", "必要素材与补拍镜头齐全"].map((text) => <label key={text}><input type="checkbox" />{text}</label>)}</div></div> : null}
    {tab === "editing" ? <div className="drawer-section"><div className="stage-detail-strip"><span>剪辑阶段</span><Badge tone="editing" color={stageColors.editing}>剪辑</Badge><small>完成后进入发布</small></div><StageScheduleField item={item} stage="editing" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} /><label className="field full"><span>剪辑备注</span><textarea className="large" value={item.editingNotes} onChange={(e) => update({ editingNotes: e.target.value })} placeholder="记录结构删改、字幕、包装、素材替换和导出要求…" /></label><div className="checklist"><strong>剪辑完成清单</strong>{["开头 5 秒直接进入场景", "案例或演示重点清楚", "字幕清楚可读", "封面与标题已确认", `${item.tier}档制作投入已控制`].map((text) => <label key={text}><input type="checkbox" />{text}</label>)}</div></div> : null}
    {tab === "publish" ? <div className="drawer-section"><StageScheduleField item={item} stage="publishing" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} label="计划发布日期" /><div className="form-grid"><label className="field"><span>发布状态</span><select value={item.publicationStatus} disabled><option value="draft">未排期</option><option value="scheduled">已排期</option><option value="published">已发布</option></select><small>由发布档期和实际发布记录自动更新。</small></label><label className="field"><span>实际发布时间</span><input type="date" value={item.publishedAt} onChange={(e) => update({ publishedAt: e.target.value })} /></label></div><label className="field full"><span>封面文案</span><input value={item.coverCopy} onChange={(e) => update({ coverCopy: e.target.value })} /></label><label className="field full"><span>发布正文</span><textarea className="large" value={item.publishCopy} onChange={(e) => update({ publishCopy: e.target.value })} /></label><label className="field full"><span>小红书链接</span><input value={item.xhsLink} onChange={(e) => update({ xhsLink: e.target.value })} placeholder="https://www.xiaohongshu.com/..." /></label>{item.publicationStatus !== "published" ? <><button className="primary-button full-button" disabled={!item.publishedAt} onClick={markPublished}>标记为已发布</button>{!item.publishedAt ? <p className="validation-note">先填写实际发布时间，系统才会计入大目标。</p> : null}</> : <div className="published-banner"><span>已发布于 {item.publishedAt} · 已进入待复盘列表</span><button onClick={unmarkPublished}>撤销发布记录</button></div>}</div> : null}
    {tab === "review" ? <div className="drawer-section review-drawer-section"><div className="section-title-row"><div><span className="eyebrow">T+3 REVIEW</span><h3>给这篇内容定型</h3></div><span className={`review-state-badge ${reviewStatus}`}>{reviewStatus === "completed" ? "已复盘" : reviewStatus === "pending" ? "待复盘" : "尚未发布"}</span></div><p className="stage-no-schedule-note">单篇内容不设置复盘档期；请在统一的“复盘日”集中处理待复盘内容。</p><section className="review-block"><header><span>01</span><div><strong>数据快照</strong><small>记录发布后的真实表现</small></div></header><div className="metrics-grid">{[["播放", "views"], ["点赞", "likes"], ["收藏", "saves"], ["评论", "comments"], ["涨粉", "followerGain"]].map(([label, key]) => <label key={key}><span>{label}</span><input type="number" min="0" value={item.metrics[key as keyof typeof item.metrics] as number} onChange={(e) => updateMetrics(key as keyof ContentItem["metrics"], Number(e.target.value))} /></label>)}</div><label className="field full"><span>数据快照日期</span><input type="date" value={item.metrics.capturedAt} onChange={(e) => updateMetrics("capturedAt", e.target.value)} /><small>建议在发布后第 3 天录入，便于横向比较内容表现。</small></label></section><section className="review-block review-rating-block"><header><span>02</span><div><strong>定型评价</strong><small>这篇内容最终值几颗星？</small></div></header><StarRating value={item.review.rating} onChange={(rating) => update({ review: { ...item.review, rating } })} /></section><section className="review-block"><header><span>03</span><div><strong>复盘分析</strong><small>写下为什么，以及下一条要怎么做</small></div></header><label className="field full"><textarea className="review-analysis-input" value={item.review.analysis} onChange={(e) => update({ review: { ...item.review, analysis: e.target.value } })} placeholder="例如：具体场景带来了高收藏，但开头进入主题太慢；下一条先展示结果，再解释过程。" /></label></section><section className="review-block review-rule-compose"><header><span>04</span><div><strong>这次学到的规则</strong><small>提炼成以后可以重复使用的一句话</small></div></header><label className="field full"><textarea value={item.review.learnedRule} onChange={(e) => update({ review: { ...item.review, learnedRule: e.target.value } })} placeholder="例如：讲工作流时，先展示最终工作台，再解释每一步。" /></label><button className="secondary-button full-button" disabled={!item.review.learnedRule.trim() || ruleDeposited} onClick={() => addRule(item.review.learnedRule)}>{ruleDeposited ? "已沉淀为内容规则" : "沉淀为内容规则"}</button></section><div className={`review-save-bar ${item.review.completedAt ? "completed" : ""}`}><div><strong>{!reviewPublished ? "发布后才能保存复盘" : item.review.completedAt ? "这篇内容已完成复盘" : "完成后再保存复盘"}</strong><small>{!reviewPublished ? "发布后会自动进入待复盘列表。" : item.review.completedAt ? `上次保存：${item.review.completedAt.slice(0, 10)}，仍可修改后更新。` : "至少需要完成星级评价和复盘分析。"}</small></div><button className="primary-button" disabled={!reviewPublished || !item.review.rating || !item.review.analysis.trim()} onClick={saveReview}>{item.review.completedAt ? "更新复盘" : "保存复盘"}</button></div></div> : null}
    <div className="drawer-footer-action"><small>永久操作，删除后无法恢复</small><button type="button" className="delete-content-button" onClick={remove}>删除此内容</button></div>
  </div></aside></div>;
}
