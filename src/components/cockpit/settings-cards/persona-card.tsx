"use client";

import { useEffect, useRef, useState } from "react";

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

type Pillar = { name: string; description: string };
type Pain = { pain: string; evidence: string };
type OfferingType = "tool" | "service" | "course";
type Offering = { name: string; type: OfferingType; description: string; targetPain: string };
type MarketInsight = { landscape: string; mainstream: string; unmet: string; opportunity: string; researchedAt: string };

type PersonaProfileData = {
  audience: string;
  targetFans: string;
  pillars: Pillar[];
  angle: string;
  avoid: string;
  // 十期: 账号定位体系扩展 — 全部可选, 八期已建档用户新字段为空时行为完全不变。
  painPoints: Pain[];
  offerings: Offering[];
  productLogic: string;
  marketInsight: MarketInsight | null;
  systemSummary: string;
};

const AUDIENCE_MAX_LEN = 300;
const PILLAR_NAME_MAX_LEN = 10;
const PILLAR_DESC_MAX_LEN = 60;
const MAX_PILLARS = 5;
const PAIN_MAX_LEN = 30;
const PAIN_EVIDENCE_MAX_LEN = 60;
const MAX_PAINS = 6;
const OFFERING_NAME_MAX_LEN = 20;
const OFFERING_DESC_MAX_LEN = 80;
const OFFERING_TARGET_PAIN_MAX_LEN = 30;
const MAX_OFFERINGS = 5;
const PRODUCT_LOGIC_MAX_LEN = 500;
/** 市场调研过期阈值 (spec §5 风险表): 超过 30 天提示「调研已过期，建议重跑」，不自动重跑。 */
const MARKET_INSIGHT_STALE_MS = 30 * 24 * 60 * 60 * 1000;

const OFFERING_TYPE_LABELS: Record<OfferingType, string> = { tool: "工具/软件", service: "咨询/代做服务", course: "课程/训练营/社群" };

const EMPTY_PROFILE: PersonaProfileData = {
  audience: "", targetFans: "", pillars: [], angle: "", avoid: "",
  painPoints: [], offerings: [], productLogic: "", marketInsight: null, systemSummary: "",
};

/**
 * 九问访谈文案 — spec §2 逐字 (docs/superpowers/specs/2026-08-15-positioning-system-design.md)。
 * 十期: 五期在八期五问基础上新增④⑤⑧⑨四问 (痛点/变现/转化路径/竞争格局)，文案顺序即
 * 提交给 /api/v1/persona/draft 的 answers 顺序。
 */
const INTERVIEW_QUESTIONS = [
  "你是谁/账号做什么",
  "最想吸引什么样的人关注",
  "你最擅长/最有信息差的内容",
  "你的目标人群最头疼什么",
  "你打算靠什么变现、具体卖什么",
  "观众为什么选择看你而不是别人",
  "绝对不想碰的内容或方向",
  "观众从刷到你到付费中间要经历什么",
  "你怎么看这个赛道现在的竞争",
] as const;

function sameProfile(a: PersonaProfileData, b: PersonaProfileData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isProfileEstablishedClient(p: PersonaProfileData): boolean {
  return p.audience.trim().length > 0 && p.pillars.length >= 1;
}

function normalizeIncoming(data: Record<string, unknown>): PersonaProfileData {
  return {
    audience: typeof data.audience === "string" ? data.audience : "",
    targetFans: typeof data.targetFans === "string" ? data.targetFans : "",
    pillars: Array.isArray(data.pillars) ? (data.pillars as Pillar[]) : [],
    angle: typeof data.angle === "string" ? data.angle : "",
    avoid: typeof data.avoid === "string" ? data.avoid : "",
    painPoints: Array.isArray(data.painPoints) ? (data.painPoints as Pain[]) : [],
    offerings: Array.isArray(data.offerings) ? (data.offerings as Offering[]) : [],
    productLogic: typeof data.productLogic === "string" ? data.productLogic : "",
    marketInsight: data.marketInsight && typeof data.marketInsight === "object" ? (data.marketInsight as MarketInsight) : null,
    systemSummary: typeof data.systemSummary === "string" ? data.systemSummary : "",
  };
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 「人设定位」设置卡 — 样式循 `style-profile-card.tsx` 先例 (同一套
 * `.panel.settings-card` / `.ai-provider-*` 体系)。八期 T1/T2: `GET/PUT
 * /api/v1/persona/profile` 与 `POST /api/v1/persona/draft`（起草只回填表单不落库）。
 *
 * 十期扩展 (T6): 新增痛点 (painPoints ≤6) / 商品服务 (offerings ≤5) / 产品逻辑
 * (productLogic) 三组可编辑字段 (随主表单一起走 PUT 全量覆盖)；新增市场调研
 * (`POST market-research`) 与体系报告 (`POST summary`) 两个独立按钮——这两者是
 * 服务端单字段直写 (不经过本地 dirty/PUT 流程)，成功后同时写回 `profile` 与
 * `savedProfile` 保持两者一致，避免被本地当成"未保存的改动"。
 */
export function PersonaCard() {
  const [profile, setProfile] = useState<PersonaProfileData>(EMPTY_PROFILE);
  const [savedProfile, setSavedProfile] = useState<PersonaProfileData>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [interviewOpen, setInterviewOpen] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => INTERVIEW_QUESTIONS.map(() => ""));
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState<Status>({ kind: "idle" });

  const [marketResearching, setMarketResearching] = useState(false);
  const [marketStatus, setMarketStatus] = useState<Status>({ kind: "idle" });

  const [summarizing, setSummarizing] = useState(false);
  const [summaryStatus, setSummaryStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/persona/profile");
        const json = await res.json();
        if (json.success) {
          const next = normalizeIncoming(json.data);
          setProfile(next);
          setSavedProfile(next);
        } else {
          setStatus({ kind: "err", msg: json.message ?? "加载失败" });
        }
      } catch (err) {
        setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = !sameProfile(profile, savedProfile);
  const established = isProfileEstablishedClient(savedProfile);

  // handleDraft 的 confirm 判断需要「点击那一刻」和「异步请求返回那一刻」两个时间点的
  // 最新 dirty 值，而闭包里的 `dirty` 只反映 handleDraft 定义时那次渲染的值。用 ref 镜像
  // 最新 profile/savedProfile，读取时始终拿到最新 state，避免起草等待期间用户改表单后被静默覆盖。
  const profileRef = useRef(profile);
  const savedProfileRef = useRef(savedProfile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    savedProfileRef.current = savedProfile;
  }, [savedProfile]);
  const isDirtyNow = () => !sameProfile(profileRef.current, savedProfileRef.current);

  // 十期: 起草/保存/市场调研/体系报告四组动作互斥——市场调研与体系报告都是服务端
  // 单字段直写, 若与"保存"并发, PUT 用的是发起时那份 profile 快照, 可能覆盖掉调研/
  // 报告刚落库的新值 (或反过来, 调研/报告完成后写回的 savedProfile 与用户正在编辑
  // 的表单产生竞态)。四个 pending 合成一个开关, 全部互斥。
  const anyBusy = saving || drafting || marketResearching || summarizing;

  const updateField = <K extends keyof PersonaProfileData>(key: K, value: PersonaProfileData[K]) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const updatePillar = (idx: number, patch: Partial<Pillar>) =>
    setProfile((prev) => ({
      ...prev,
      pillars: prev.pillars.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));

  const addPillar = () => {
    if (profile.pillars.length >= MAX_PILLARS) return;
    setProfile((prev) => ({ ...prev, pillars: [...prev.pillars, { name: "", description: "" }] }));
  };

  const removePillar = (idx: number) =>
    setProfile((prev) => ({ ...prev, pillars: prev.pillars.filter((_, i) => i !== idx) }));

  const updatePain = (idx: number, patch: Partial<Pain>) =>
    setProfile((prev) => ({ ...prev, painPoints: prev.painPoints.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }));

  const addPain = () => {
    if (profile.painPoints.length >= MAX_PAINS) return;
    setProfile((prev) => ({ ...prev, painPoints: [...prev.painPoints, { pain: "", evidence: "" }] }));
  };

  const removePain = (idx: number) =>
    setProfile((prev) => ({ ...prev, painPoints: prev.painPoints.filter((_, i) => i !== idx) }));

  const updateOffering = (idx: number, patch: Partial<Offering>) =>
    setProfile((prev) => ({ ...prev, offerings: prev.offerings.map((o, i) => (i === idx ? { ...o, ...patch } : o)) }));

  const addOffering = () => {
    if (profile.offerings.length >= MAX_OFFERINGS) return;
    setProfile((prev) => ({ ...prev, offerings: [...prev.offerings, { name: "", type: "tool", description: "", targetPain: "" }] }));
  };

  const removeOffering = (idx: number) =>
    setProfile((prev) => ({ ...prev, offerings: prev.offerings.filter((_, i) => i !== idx) }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (anyBusy || !dirty) return;
    setStatus({ kind: "idle" });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/persona/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const json = await res.json();
      if (json.success) {
        const next = normalizeIncoming(json.data);
        setProfile(next);
        setSavedProfile(next);
        setStatus({ kind: "ok", msg: "已保存" });
      } else {
        setStatus({ kind: "err", msg: json.message ?? "保存失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDraft = async () => {
    if (anyBusy) return;
    // confirm 提前到发请求之前：点击时若已脏，先确认是否愿意覆盖，取消就不发 LLM 请求（不花钱）。
    if (isDirtyNow() && !window.confirm("将覆盖当前未保存内容，是否继续？")) return;
    setDraftStatus({ kind: "idle" });
    setDrafting(true);
    try {
      const res = await fetch("/api/v1/persona/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: INTERVIEW_QUESTIONS.map((q, i) => ({ q, a: answers[i] ?? "" })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (res.status === 503) {
          setDraftStatus({ kind: "err", msg: `${json.message || "服务端未配置 DeepSeek key"}，请前往「设置 → AI 服务配置」保存后重试` });
        } else {
          setDraftStatus({ kind: "err", msg: json.message ?? "起草失败" });
        }
        return;
      }
      // 二次核对：请求返回时用最新 state 重新判断 dirty（等待期间用户可能又改了表单，
      // 即便点击那一刻已经确认过一次也要再问一遍，否则会静默覆盖用户新改动）。
      if (isDirtyNow() && !window.confirm("将覆盖当前未保存内容，是否继续？")) return;
      const draft = normalizeIncoming(json.data.draft as Record<string, unknown>);
      setProfile((prev) => ({
        ...draft,
        // 起草 prompt 不产出 marketInsight/systemSummary (需要联网调研/依赖其余字段先写完,
        // 见 persona-draft.ts 顶部注释)——保留当前值，不被草稿的空值静默清空。
        marketInsight: prev.marketInsight,
        systemSummary: prev.systemSummary,
      }));
      setDraftStatus({ kind: "ok", msg: "已生成草稿，请检查后保存" });
      setInterviewOpen(false);
    } catch (err) {
      setDraftStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDrafting(false);
    }
  };

  const handleMarketResearch = async () => {
    if (anyBusy) return;
    setMarketStatus({ kind: "idle" });
    setMarketResearching(true);
    try {
      const res = await fetch("/api/v1/persona/market-research", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        const marketInsight = json.data.marketInsight as MarketInsight;
        // 服务端单字段直写——本地同步更新 profile 与 savedProfile 两份, 避免出现
        // "调研成功了，但表单显示未保存改动" 的错位。
        setProfile((prev) => ({ ...prev, marketInsight }));
        setSavedProfile((prev) => ({ ...prev, marketInsight }));
        setMarketStatus({ kind: "ok", msg: "市场调研已更新" });
      } else {
        setMarketStatus({ kind: "err", msg: json.message ?? "市场调研失败" });
      }
    } catch (err) {
      setMarketStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setMarketResearching(false);
    }
  };

  const handleSummary = async () => {
    if (anyBusy) return;
    setSummaryStatus({ kind: "idle" });
    setSummarizing(true);
    try {
      const res = await fetch("/api/v1/persona/summary", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        const summary = json.data.summary as string;
        setProfile((prev) => ({ ...prev, systemSummary: summary }));
        setSavedProfile((prev) => ({ ...prev, systemSummary: summary }));
        setSummaryStatus({ kind: "ok", msg: "体系报告已生成" });
      } else {
        setSummaryStatus({ kind: "err", msg: json.message ?? "体系报告生成失败" });
      }
    } catch (err) {
      setSummaryStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSummarizing(false);
    }
  };

  const researchedAtDate = profile.marketInsight ? new Date(profile.marketInsight.researchedAt) : null;
  const marketInsightStale = researchedAtDate && !Number.isNaN(researchedAtDate.getTime())
    ? Date.now() - researchedAtDate.getTime() > MARKET_INSIGHT_STALE_MS
    : false;

  return <div className="panel settings-card wide persona-card">
    <div className="settings-icon">◎</div>
    <div>
      <h2>人设定位</h2>
      <p>写清楚「你是谁、想吸引谁、擅长讲什么、变现靠什么」，热点雷达打分、选题推荐和生成角度都会参考它，让内容更贴合你的定位。不确定怎么写？点「AI 帮我起草」回答几个问题，AI 会帮你起草初稿。</p>

      <div className="persona-draft-trigger">
        <button type="button" className="text-button" disabled={anyBusy} onClick={() => setInterviewOpen((v) => !v)}>
          {interviewOpen ? "收起访谈 ↑" : "AI 帮我起草 →"}
        </button>
      </div>

      {interviewOpen ? <div className="persona-interview">
        <p className="radar-keyword-hint">回答以下问题（可留空），AI 会综合你的风格档案、定稿样本和关注中的热点关键词起草一份档案初稿（含痛点/商品服务/转化路径），仅回填表单，不会直接保存。</p>
        {INTERVIEW_QUESTIONS.map((q, i) => <label key={q} className="field full">
          <span>{q}</span>
          <textarea
            value={answers[i]}
            onChange={(e) => setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))}
            disabled={drafting}
          />
        </label>)}
        <div className="ai-provider-form-actions">
          <button type="button" className="secondary-button" disabled={anyBusy} onClick={handleDraft}>{drafting ? "起草中..." : "生成草稿"}</button>
          {draftStatus.kind === "ok" ? <span className="ai-provider-status ok">{draftStatus.msg}</span> : null}
          {draftStatus.kind === "err" ? <span className="ai-provider-status err">{draftStatus.msg}</span> : null}
        </div>
      </div> : null}

      <form className="ai-provider-form persona-form" onSubmit={handleSave}>
        <label className="field full">
          <span>目标受众画像</span>
          <textarea
            value={profile.audience}
            onChange={(e) => updateField("audience", e.target.value)}
            maxLength={AUDIENCE_MAX_LEN}
            placeholder="谁在看你的内容？"
            disabled={loading || anyBusy}
          />
          <small className="field-hint">{profile.audience.length} / {AUDIENCE_MAX_LEN}</small>
        </label>
        <label className="field full">
          <span>想吸引的粉丝与流量</span>
          <textarea
            value={profile.targetFans}
            onChange={(e) => updateField("targetFans", e.target.value)}
            maxLength={AUDIENCE_MAX_LEN}
            placeholder="想让谁多看/关注？"
            disabled={loading || anyBusy}
          />
          <small className="field-hint">{profile.targetFans.length} / {AUDIENCE_MAX_LEN}</small>
        </label>

        <div className="persona-pillars">
          <div className="persona-pillars-heading">
            <span>内容支柱（最多 {MAX_PILLARS} 条）</span>
            <button type="button" className="text-button" disabled={loading || anyBusy || profile.pillars.length >= MAX_PILLARS} onClick={addPillar}>+ 添加支柱</button>
          </div>
          {profile.pillars.length === 0 ? <p className="goal-empty-copy">暂无内容支柱</p> : <ul className="ai-provider-list persona-pillar-list">
            {profile.pillars.map((pillar, idx) => <li key={idx}>
              <div className="persona-pillar-inputs">
                <input
                  value={pillar.name}
                  onChange={(e) => updatePillar(idx, { name: e.target.value })}
                  maxLength={PILLAR_NAME_MAX_LEN}
                  placeholder="支柱名称"
                  disabled={loading || anyBusy}
                />
                <input
                  value={pillar.description}
                  onChange={(e) => updatePillar(idx, { description: e.target.value })}
                  maxLength={PILLAR_DESC_MAX_LEN}
                  placeholder="支柱描述"
                  disabled={loading || anyBusy}
                />
              </div>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button danger" disabled={loading || anyBusy} onClick={() => removePillar(idx)}>删除</button>
              </div>
            </li>)}
          </ul>}
        </div>

        <label className="field full">
          <span>差异化角度</span>
          <textarea
            value={profile.angle}
            onChange={(e) => updateField("angle", e.target.value)}
            maxLength={AUDIENCE_MAX_LEN}
            placeholder="为什么该看你而不是别人？"
            disabled={loading || anyBusy}
          />
          <small className="field-hint">{profile.angle.length} / {AUDIENCE_MAX_LEN}</small>
        </label>
        <label className="field full">
          <span>明确不做什么</span>
          <textarea
            value={profile.avoid}
            onChange={(e) => updateField("avoid", e.target.value)}
            maxLength={AUDIENCE_MAX_LEN}
            placeholder="绝对不想碰的内容或方向"
            disabled={loading || anyBusy}
          />
          <small className="field-hint">{profile.avoid.length} / {AUDIENCE_MAX_LEN}</small>
        </label>

        <div className="persona-pillars">
          <div className="persona-pillars-heading">
            <span>关键痛点（最多 {MAX_PAINS} 条）</span>
            <button type="button" className="text-button" disabled={loading || anyBusy || profile.painPoints.length >= MAX_PAINS} onClick={addPain}>+ 添加痛点</button>
          </div>
          {profile.painPoints.length === 0 ? <p className="goal-empty-copy">暂无痛点记录</p> : <ul className="ai-provider-list persona-pain-list">
            {profile.painPoints.map((pain, idx) => <li key={idx}>
              <div className="persona-pain-inputs">
                <input
                  value={pain.pain}
                  onChange={(e) => updatePain(idx, { pain: e.target.value })}
                  maxLength={PAIN_MAX_LEN}
                  placeholder="痛点（≤30字）"
                  disabled={loading || anyBusy}
                />
                <input
                  value={pain.evidence}
                  onChange={(e) => updatePain(idx, { evidence: e.target.value })}
                  maxLength={PAIN_EVIDENCE_MAX_LEN}
                  placeholder="依据（≤60字）"
                  disabled={loading || anyBusy}
                />
              </div>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button danger" disabled={loading || anyBusy} onClick={() => removePain(idx)}>删除</button>
              </div>
            </li>)}
          </ul>}
        </div>

        <div className="persona-pillars">
          <div className="persona-pillars-heading">
            <span>商品 / 服务（最多 {MAX_OFFERINGS} 条）</span>
            <button type="button" className="text-button" disabled={loading || anyBusy || profile.offerings.length >= MAX_OFFERINGS} onClick={addOffering}>+ 添加商品/服务</button>
          </div>
          {profile.offerings.length === 0 ? <p className="goal-empty-copy">暂无商品/服务</p> : <ul className="ai-provider-list persona-offering-list">
            {profile.offerings.map((offering, idx) => <li key={idx}>
              <div className="persona-offering-inputs">
                <input
                  value={offering.name}
                  onChange={(e) => updateOffering(idx, { name: e.target.value })}
                  maxLength={OFFERING_NAME_MAX_LEN}
                  placeholder="名称（≤20字）"
                  disabled={loading || anyBusy}
                />
                <select
                  value={offering.type}
                  onChange={(e) => updateOffering(idx, { type: e.target.value as OfferingType })}
                  disabled={loading || anyBusy}
                  aria-label="类型"
                >
                  {(Object.keys(OFFERING_TYPE_LABELS) as OfferingType[]).map((t) => <option key={t} value={t}>{OFFERING_TYPE_LABELS[t]}</option>)}
                </select>
                <input
                  value={offering.description}
                  onChange={(e) => updateOffering(idx, { description: e.target.value })}
                  maxLength={OFFERING_DESC_MAX_LEN}
                  placeholder="描述（≤80字）"
                  disabled={loading || anyBusy}
                />
                <input
                  value={offering.targetPain}
                  onChange={(e) => updateOffering(idx, { targetPain: e.target.value })}
                  maxLength={OFFERING_TARGET_PAIN_MAX_LEN}
                  placeholder="解决哪个痛点（≤30字）"
                  disabled={loading || anyBusy}
                />
              </div>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button danger" disabled={loading || anyBusy} onClick={() => removeOffering(idx)}>删除</button>
              </div>
            </li>)}
          </ul>}
        </div>

        <label className="field full">
          <span>产品逻辑（观众从刷到你到付费中间要经历什么）</span>
          <textarea
            value={profile.productLogic}
            onChange={(e) => updateField("productLogic", e.target.value)}
            maxLength={PRODUCT_LOGIC_MAX_LEN}
            placeholder="刷到 → 关注 → 信任 → 付费，每一步发生了什么？"
            disabled={loading || anyBusy}
          />
          <small className="field-hint">{profile.productLogic.length} / {PRODUCT_LOGIC_MAX_LEN}</small>
        </label>

        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={anyBusy || loading || !dirty}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>

      <div className="persona-market-panel">
        <div className="persona-pillars-heading">
          <span>市场调研</span>
          <button type="button" className="secondary-button small" disabled={anyBusy || loading || !established} onClick={handleMarketResearch}>
            {marketResearching ? "调研中…" : profile.marketInsight ? "重新调研" : "开始调研"}
          </button>
        </div>
        {!established ? <p className="field-hint">先完善「目标受众」与至少 1 条「内容支柱」并保存，才能开始市场调研。</p> : null}
        {profile.marketInsight ? <div className="market-insight-block">
          <p><strong>赛道格局：</strong>{profile.marketInsight.landscape}</p>
          <p><strong>主流玩法：</strong>{profile.marketInsight.mainstream}</p>
          <p><strong>未满足需求：</strong>{profile.marketInsight.unmet}</p>
          <p><strong>机会点：</strong>{profile.marketInsight.opportunity}</p>
          <small className={`field-hint ${marketInsightStale ? "market-insight-stale" : ""}`}>
            调研时间：{profile.marketInsight.researchedAt.slice(0, 10)}{marketInsightStale ? " · 调研已过期，建议重跑" : ""}
          </small>
        </div> : <p className="goal-empty-copy">还没有市场调研结果</p>}
        {marketStatus.kind === "ok" ? <span className="ai-provider-status ok">{marketStatus.msg}</span> : null}
        {marketStatus.kind === "err" ? <span className="ai-provider-status err">{marketStatus.msg}</span> : null}
      </div>

      <div className="persona-summary-panel">
        <div className="persona-pillars-heading">
          <span>定位体系报告</span>
          <div className="ai-provider-list-actions">
            {profile.systemSummary ? <button type="button" className="text-button" onClick={() => downloadMarkdown("账号定位体系.md", profile.systemSummary)}>导出 .md</button> : null}
            <button type="button" className="secondary-button small" disabled={anyBusy || loading || !established} onClick={handleSummary}>
              {summarizing ? "生成中…" : profile.systemSummary ? "重新生成" : "生成定位体系"}
            </button>
          </div>
        </div>
        {!established ? <p className="field-hint">先完善「目标受众」与至少 1 条「内容支柱」并保存，才能生成体系报告。</p> : null}
        {profile.systemSummary ? <pre className="system-summary-body">{profile.systemSummary}</pre> : <p className="goal-empty-copy">还没有生成定位体系报告</p>}
        {summaryStatus.kind === "ok" ? <span className="ai-provider-status ok">{summaryStatus.msg}</span> : null}
        {summaryStatus.kind === "err" ? <span className="ai-provider-status err">{summaryStatus.msg}</span> : null}
      </div>
    </div>
  </div>;
}
