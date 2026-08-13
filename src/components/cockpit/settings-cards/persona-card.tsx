"use client";

import { useEffect, useState } from "react";

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

type Pillar = { name: string; description: string };

type PersonaProfileData = {
  audience: string;
  targetFans: string;
  pillars: Pillar[];
  angle: string;
  avoid: string;
};

const AUDIENCE_MAX_LEN = 300;
const PILLAR_NAME_MAX_LEN = 10;
const PILLAR_DESC_MAX_LEN = 60;
const MAX_PILLARS = 5;

const EMPTY_PROFILE: PersonaProfileData = { audience: "", targetFans: "", pillars: [], angle: "", avoid: "" };

/** 五问访谈文案 — spec §2 逐字 (docs/superpowers/specs/2026-08-14-persona-driven-topics-design.md)。 */
const INTERVIEW_QUESTIONS = [
  "你是谁/账号做什么",
  "最想吸引什么样的人关注",
  "你最擅长/最有信息差的内容",
  "观众为什么选择看你而不是别人",
  "绝对不想碰的内容或方向",
] as const;

function sameProfile(a: PersonaProfileData, b: PersonaProfileData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 「人设定位」设置卡 — 样式循 `style-profile-card.tsx` 先例 (同一套
 * `.panel.settings-card` / `.ai-provider-*` 体系)。对应八期 T1/T2 两组 API:
 * `GET/PUT /api/v1/persona/profile`（五字段编辑, PUT 全量覆盖）与
 * `POST /api/v1/persona/draft`（5 问访谈 → DeepSeek 起草, 只回填表单不落库，
 * 见 spec §2「重访谈只覆盖表单草稿, 不动已存档案」）。
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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/persona/profile");
        const json = await res.json();
        if (json.success) {
          const next: PersonaProfileData = {
            audience: json.data.audience ?? "",
            targetFans: json.data.targetFans ?? "",
            pillars: Array.isArray(json.data.pillars) ? json.data.pillars : [],
            angle: json.data.angle ?? "",
            avoid: json.data.avoid ?? "",
          };
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !dirty) return;
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
        const next: PersonaProfileData = {
          audience: json.data.audience ?? "",
          targetFans: json.data.targetFans ?? "",
          pillars: Array.isArray(json.data.pillars) ? json.data.pillars : [],
          angle: json.data.angle ?? "",
          avoid: json.data.avoid ?? "",
        };
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
    if (drafting) return;
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
      const draft = json.data.draft as PersonaProfileData;
      if (dirty && !window.confirm("将覆盖当前未保存内容，是否继续？")) return;
      setProfile({
        audience: draft.audience ?? "",
        targetFans: draft.targetFans ?? "",
        pillars: Array.isArray(draft.pillars) ? draft.pillars : [],
        angle: draft.angle ?? "",
        avoid: draft.avoid ?? "",
      });
      setDraftStatus({ kind: "ok", msg: "已生成草稿，请检查后保存" });
      setInterviewOpen(false);
    } catch (err) {
      setDraftStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDrafting(false);
    }
  };

  return <div className="panel settings-card wide persona-card">
    <div className="settings-icon">◎</div>
    <div>
      <h2>人设定位</h2>
      <p>写清楚「你是谁、想吸引谁、擅长讲什么」，热点雷达打分、选题推荐和生成角度都会参考它，让内容更贴合你的定位。不确定怎么写？点「AI 帮我起草」回答几个问题，AI 会帮你起草初稿。</p>

      <div className="persona-draft-trigger">
        <button type="button" className="text-button" disabled={drafting} onClick={() => setInterviewOpen((v) => !v)}>
          {interviewOpen ? "收起访谈 ↑" : "AI 帮我起草 →"}
        </button>
      </div>

      {interviewOpen ? <div className="persona-interview">
        <p className="radar-keyword-hint">回答以下问题（可留空），AI 会综合你的风格档案、定稿样本和关注中的热点关键词起草一份档案初稿，仅回填表单，不会直接保存。</p>
        {INTERVIEW_QUESTIONS.map((q, i) => <label key={q} className="field full">
          <span>{q}</span>
          <textarea
            value={answers[i]}
            onChange={(e) => setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))}
            disabled={drafting}
          />
        </label>)}
        <div className="ai-provider-form-actions">
          <button type="button" className="secondary-button" disabled={drafting} onClick={handleDraft}>{drafting ? "起草中..." : "生成草稿"}</button>
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
            disabled={loading || saving}
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
            disabled={loading || saving}
          />
          <small className="field-hint">{profile.targetFans.length} / {AUDIENCE_MAX_LEN}</small>
        </label>

        <div className="persona-pillars">
          <div className="persona-pillars-heading">
            <span>内容支柱（最多 {MAX_PILLARS} 条）</span>
            <button type="button" className="text-button" disabled={loading || saving || profile.pillars.length >= MAX_PILLARS} onClick={addPillar}>+ 添加支柱</button>
          </div>
          {profile.pillars.length === 0 ? <p className="goal-empty-copy">暂无内容支柱</p> : <ul className="ai-provider-list persona-pillar-list">
            {profile.pillars.map((pillar, idx) => <li key={idx}>
              <div className="persona-pillar-inputs">
                <input
                  value={pillar.name}
                  onChange={(e) => updatePillar(idx, { name: e.target.value })}
                  maxLength={PILLAR_NAME_MAX_LEN}
                  placeholder="支柱名称"
                  disabled={loading || saving}
                />
                <input
                  value={pillar.description}
                  onChange={(e) => updatePillar(idx, { description: e.target.value })}
                  maxLength={PILLAR_DESC_MAX_LEN}
                  placeholder="支柱描述"
                  disabled={loading || saving}
                />
              </div>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button danger" disabled={loading || saving} onClick={() => removePillar(idx)}>删除</button>
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
            disabled={loading || saving}
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
            disabled={loading || saving}
          />
          <small className="field-hint">{profile.avoid.length} / {AUDIENCE_MAX_LEN}</small>
        </label>

        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={saving || loading || !dirty}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>
    </div>
  </div>;
}
