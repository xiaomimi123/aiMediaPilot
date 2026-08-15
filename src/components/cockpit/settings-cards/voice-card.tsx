"use client";

import { useEffect, useRef, useState } from "react";

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

type Stance = { claim: string; reason: string };
type VoiceData = {
  origin: string;
  identity: string;
  notIdentity: string;
  stances: Stance[];
  energy: string;
};

const MAX_STANCES = 5;
const EMPTY: VoiceData = { origin: "", identity: "", notIdentity: "", stances: [], energy: "" };

/** 6 问访谈文案逐字取自 spec §2（docs/superpowers/specs/2026-08-16-creator-voice-design.md）。 */
const INTERVIEW_QUESTIONS = [
  "你怎么走上这条路的？哪件事让你决定开始做",
  "你会怎么跟陌生人介绍自己（一句话）",
  "你明确不是什么人",
  "关于这个领域，你有什么跟主流不一样的看法",
  "你希望观众看完是什么感觉",
  "你最近一次认知被刷新是什么时候",
] as const;

/**
 * 「人物志」卡 —— 回答「你是谁」，与「人设定位」卡（回答「你做什么生意」）分开。
 *
 * 语言层（口吻/句式/口头禅）不在这里，归「风格档案」卡；十二期设计明确切分，避免
 * 两处都写导致写稿 prompt 收到自相矛盾的指令。
 *
 * 起草/保存互斥与 confirm 前置沿八/十期 persona-card 的既有模式：dirty 判断用 ref
 * 取最新值（闭包旧值会在 LLM 等待期间读到过期状态），点击时先 confirm 再发请求（取消
 * 就不花钱），响应回来再核对一次（等待期间用户又改了）。
 */
export function VoiceCard() {
  const [voice, setVoice] = useState<VoiceData>(EMPTY);
  const [savedVoice, setSavedVoice] = useState<VoiceData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showInterview, setShowInterview] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => INTERVIEW_QUESTIONS.map(() => ""));
  const [candidates, setCandidates] = useState<string[]>([]);
  const [savingCandidate, setSavingCandidate] = useState<number | null>(null);

  const voiceRef = useRef(voice);
  const savedRef = useRef(savedVoice);
  voiceRef.current = voice;
  savedRef.current = savedVoice;

  const busy = saving || drafting || loading;
  const isDirtyNow = () => JSON.stringify(voiceRef.current) !== JSON.stringify(savedRef.current);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/voice/profile");
        const json = await res.json();
        if (json.success) {
          const next: VoiceData = {
            origin: json.data.origin ?? "",
            identity: json.data.identity ?? "",
            notIdentity: json.data.notIdentity ?? "",
            stances: Array.isArray(json.data.stances) ? json.data.stances : [],
            energy: json.data.energy ?? "",
          };
          setVoice(next);
          setSavedVoice(next);
        }
      } catch {
        // 静默：加载失败时保持空态，用户仍可填写并保存
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (patch: Partial<VoiceData>) => setVoice((prev) => ({ ...prev, ...patch }));

  const updateStance = (idx: number, patch: Partial<Stance>) =>
    setVoice((prev) => ({
      ...prev,
      stances: prev.stances.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));

  const addStance = () =>
    setVoice((prev) =>
      prev.stances.length >= MAX_STANCES
        ? prev
        : { ...prev, stances: [...prev.stances, { claim: "", reason: "" }] },
    );

  const removeStance = (idx: number) =>
    setVoice((prev) => ({ ...prev, stances: prev.stances.filter((_, i) => i !== idx) }));

  const handleDraft = async () => {
    if (drafting || saving) return;
    if (isDirtyNow() && !window.confirm("将覆盖当前未保存内容，是否继续？")) return;
    setDrafting(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/v1/voice/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: INTERVIEW_QUESTIONS.map((q, i) => ({ q, a: answers[i] ?? "" })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setStatus({
          kind: "err",
          msg:
            res.status === 503
              ? "未配置 DeepSeek key，请前往「设置 → AI 服务配置」保存后重试"
              : (json.message ?? "起草失败"),
        });
        return;
      }
      // 响应回来再核对一次 —— 等待期间用户可能又改了表单
      if (isDirtyNow() && !window.confirm("起草完成，将覆盖你在等待期间的改动，是否继续？")) return;
      const d = json.data.draft;
      setVoice({
        origin: d.origin ?? "",
        identity: d.identity ?? "",
        notIdentity: d.notIdentity ?? "",
        stances: Array.isArray(d.stances) ? d.stances : [],
        energy: d.energy ?? "",
      });
      setCandidates(Array.isArray(d.experienceCandidates) ? d.experienceCandidates : []);
      setStatus({ kind: "ok", msg: "已起草，请逐项修改后保存" });
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDrafting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || drafting || loading) return;
    setSaving(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/v1/voice/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(voice),
      });
      const json = await res.json();
      if (json.success) {
        setSavedVoice(voice);
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

  /** 经历候选逐条入库 —— 用户没确认的不入库（起草本身不落库）。 */
  const saveCandidate = async (idx: number) => {
    if (savingCandidate !== null) return;
    setSavingCandidate(idx);
    try {
      const res = await fetch("/api/v1/experiences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: candidates[idx] }),
      });
      const json = await res.json();
      if (json.success) {
        setCandidates((prev) => prev.filter((_, i) => i !== idx));
        setStatus({ kind: "ok", msg: "已存入经历库（可在下方「个人经历库」查看）" });
      } else {
        setStatus({ kind: "err", msg: json.message ?? "存入失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingCandidate(null);
    }
  };

  return (
    <div className="panel settings-card wide ai-provider-settings-card">
      <div className="settings-icon">◍</div>
      <div>
        <h2>人物志</h2>
        <p>
          回答「你是谁」——身份、来路、立场、表达能量。写稿时注入，让稿子有人味。
          「怎么说话」不在这里，归下方「风格档案」。
        </p>

        <form className="ai-provider-form" onSubmit={handleSave}>
          <label className="field full">
            <span>我是谁（一句话具体身份，不是品类标签）</span>
            <textarea
              value={voice.identity}
              maxLength={200}
              onChange={(e) => update({ identity: e.target.value })}
              placeholder="例：一个靠 AI 提高认知的普通人，边学边把踩过的坑讲出来"
            />
          </label>

          <label className="field full">
            <span>我不是什么（护栏：防止 AI 把你写成你不是的专家）</span>
            <textarea
              value={voice.notIdentity}
              maxLength={200}
              onChange={(e) => update({ notIdentity: e.target.value })}
              placeholder="例：不是资深技术极客，也不是专业程序员"
            />
          </label>

          <label className="field full">
            <span>表达能量（观众感受到的你）</span>
            <textarea
              value={voice.energy}
              maxLength={200}
              onChange={(e) => update({ energy: e.target.value })}
              placeholder="例：自信、有感染力"
            />
          </label>

          <label className="field full">
            <span>来路故事（为什么走上这条路）</span>
            <textarea
              className="large"
              value={voice.origin}
              maxLength={500}
              onChange={(e) => update({ origin: e.target.value })}
            />
          </label>

          <div className="field full">
            <span>我的立场（写稿时可旗帜鲜明表达，最多 {MAX_STANCES} 条）</span>
            {voice.stances.map((s, idx) => (
              <div key={idx} className="voice-stance-row">
                <input
                  value={s.claim}
                  maxLength={50}
                  onChange={(e) => updateStance(idx, { claim: e.target.value })}
                  placeholder="我认为……"
                />
                <input
                  value={s.reason}
                  maxLength={100}
                  onChange={(e) => updateStance(idx, { reason: e.target.value })}
                  placeholder="为什么"
                />
                <button type="button" className="text-button" onClick={() => removeStance(idx)}>
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={voice.stances.length >= MAX_STANCES}
              onClick={addStance}
            >
              ＋ 添加立场
            </button>
          </div>

          <div className="ai-provider-form-actions">
            <button type="submit" className="ai-button small" disabled={busy}>
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setShowInterview((v) => !v)}
            >
              {showInterview ? "收起访谈" : "AI 帮我起草"}
            </button>
            {status.kind === "ok" ? (
              <span className="ai-provider-status ok">{status.msg}</span>
            ) : null}
            {status.kind === "err" ? (
              <span className="ai-provider-status err">{status.msg}</span>
            ) : null}
          </div>
        </form>

        {showInterview ? (
          <div className="voice-interview">
            <p className="field-hint">回答下面 6 个问题（可留空），AI 会据此起草人物志。</p>
            {INTERVIEW_QUESTIONS.map((q, idx) => (
              <label key={q} className="field full">
                <span>
                  {idx + 1}. {q}
                </span>
                <textarea
                  value={answers[idx] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => prev.map((a, i) => (i === idx ? e.target.value : a)))
                  }
                />
              </label>
            ))}
            <button type="button" className="ai-button small" disabled={busy} onClick={handleDraft}>
              {drafting ? "起草中…" : "开始起草"}
            </button>
          </div>
        ) : null}

        {candidates.length > 0 ? (
          <div className="voice-candidates">
            <h3>AI 从你的回答里提取到的经历</h3>
            <p className="field-hint">确认无误的可以存进经历库，写稿时会优先引用。</p>
            <ul className="ai-provider-list">
              {candidates.map((c, idx) => (
                <li key={idx}>
                  <div>{c}</div>
                  <div className="ai-provider-list-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={savingCandidate !== null}
                      onClick={() => saveCandidate(idx)}
                    >
                      {savingCandidate === idx ? "存入中…" : "存入经历库"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setCandidates((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      忽略
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
