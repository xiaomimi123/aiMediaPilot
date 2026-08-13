"use client";

import { useEffect, useState } from "react";
import { CONTENT_PLATFORM_LABEL, isContentPlatform } from "@/lib/platform";

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

type StyleSample = { id: string; platform: string; preview: string; createdAt: string };

const DESCRIPTION_MAX_LEN = 2000;
const PREVIEW_LEN = 200; // 与 GET /api/v1/style/samples 服务端截断长度一致，用于判断是否要补「…」

/**
 * 「风格档案」设置卡 — 样式循 `radar-config-card.tsx` 先例（同一套 `.ai-provider-*`
 * 体系），逻辑对应 T6 两组 API：`GET/PUT /api/v1/style/profile`（一段博主风格文字
 * 描述，供 T4 写稿 / T5 改稿在没有定稿样本时兜底参考）与 `GET /api/v1/style/samples`
 * + `DELETE .../[id]`（样本只读列表 + 单条删除）。样本本身由「定稿(picked)」流程
 * 自动沉淀（见 `/api/v1/scripts/[id]/picked` 里的 `depositStyleSample`），这张卡
 * 不提供新增样本的入口，避免和定稿闭环出现两条写入路径。
 */
export function StyleProfileCard() {
  const [description, setDescription] = useState("");
  const [savedDescription, setSavedDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [samples, setSamples] = useState<StyleSample[] | null>(null);
  const [samplesStatus, setSamplesStatus] = useState<Status>({ kind: "idle" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshProfile = async () => {
    try {
      const res = await fetch("/api/v1/style/profile");
      const json = await res.json();
      if (json.success) {
        setDescription(json.data.description ?? "");
        setSavedDescription(json.data.description ?? "");
      } else {
        setStatus({ kind: "err", msg: json.message ?? "加载失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const refreshSamples = async () => {
    try {
      const res = await fetch("/api/v1/style/samples");
      const json = await res.json();
      if (json.success) setSamples(json.data.samples);
      else setSamplesStatus({ kind: "err", msg: json.message ?? "加载失败" });
    } catch (err) {
      setSamplesStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    refreshProfile();
    refreshSamples();
  }, []);

  const dirty = description !== savedDescription;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !dirty) return;
    setStatus({ kind: "idle" });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/style/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (json.success) {
        setDescription(json.data.description);
        setSavedDescription(json.data.description);
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

  const handleDeleteSample = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setSamplesStatus({ kind: "idle" });
    try {
      const res = await fetch(`/api/v1/style/samples/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setSamples((prev) => (prev ? prev.filter((sample) => sample.id !== id) : prev));
      } else {
        setSamplesStatus({ kind: "err", msg: json.message ?? "删除失败" });
      }
    } catch (err) {
      setSamplesStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDeletingId(null);
    }
  };

  return <div className="panel settings-card wide style-profile-card">
    <div className="settings-icon">✎</div>
    <div>
      <h2>风格档案</h2>
      <p>写一段你的口播风格描述（语速、口头禅、句式偏好），AI 写稿 / 改稿会参考它；只要你「定稿」过至少一篇逐字稿，系统会优先直接模仿定稿样本原文，这段描述转为样本不足时的兜底参考。</p>
      <form className="ai-provider-form" onSubmit={handleSave}>
        <label className="field full">
          <span>风格描述</span>
          <textarea
            className="large"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX_LEN}
            placeholder="例如：语速偏快，喜欢用反问开头，习惯在结尾抛一个反常识观点…"
            disabled={loading || saving}
          />
          <small className="field-hint">{description.length} / {DESCRIPTION_MAX_LEN}</small>
        </label>
        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={saving || loading || !dirty}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>

      <h3 className="radar-keyword-heading">定稿样本</h3>
      <p className="radar-keyword-hint">每次「定稿」一篇逐字稿都会自动沉淀一份样本；样本越多，AI 写稿越接近你本人的口吻。这里只能查看和删除，新增样本走脚本定稿流程。</p>
      {samplesStatus.kind === "err" ? <p className="ai-provider-status err">{samplesStatus.msg}</p> : null}
      {samples ? (samples.length ? <ul className="ai-provider-list style-sample-list">
        {samples.map((sample) => <li key={sample.id}>
          <div>
            <strong>{isContentPlatform(sample.platform) ? CONTENT_PLATFORM_LABEL[sample.platform] : sample.platform}</strong>
            <small>{sample.preview}{sample.preview.length >= PREVIEW_LEN ? "…" : ""}</small>
            <small>{new Date(sample.createdAt).toLocaleString()}</small>
          </div>
          <div className="ai-provider-list-actions">
            <button type="button" className="text-button danger" disabled={deletingId === sample.id} onClick={() => handleDeleteSample(sample.id)}>{deletingId === sample.id ? "删除中…" : "删除"}</button>
          </div>
        </li>)}
      </ul> : <p className="goal-empty-copy">暂无定稿样本</p>) : <p className="goal-empty-copy">加载中...</p>}
    </div>
  </div>;
}
