"use client";

import { useEffect, useState } from "react";
import { EXPERIENCE_KIND_LABELS, type ExperienceKind } from "@/lib/persona/voice";

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

type Experience = {
  id: string;
  content: string;
  topic: string;
  kind: string;
  keywords: string[];
  usedCount: number;
  createdAt: string;
};

const CONTENT_MAX_LEN = 500;

function kindLabel(kind: string): string {
  return EXPERIENCE_KIND_LABELS[kind as ExperienceKind] ?? "";
}

/**
 * 「个人经历库」卡 —— 回答「你凭什么这么说」。
 *
 * 写稿前按主题关键词自动检索（matchExperiences），命中的经历会作为最高优先级素材
 * 进研究层、并原文注入写稿 prompt，让稿子引用你自己的故事而不是网上搜来的第三方案例。
 *
 * 「随手记一笔」是刻意做成零门槛的：不需要分类、不需要起标题，写完就存，AI 自动打标签。
 * keywords 可人工编辑 —— AI 提取质量不稳，而它直接决定将来能不能被检索到。
 */
export function ExperienceCard() {
  const [items, setItems] = useState<Experience[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeywords, setEditKeywords] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/v1/experiences");
      const json = await res.json();
      if (json.success) setItems(json.data.experiences ?? []);
      else setItems([]);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/v1/experiences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (json.success) {
        setDraft("");
        await refresh();
        setStatus(
          json.data.tagged
            ? { kind: "ok", msg: "已记下，AI 已自动归类" }
            : { kind: "ok", msg: "已记下（自动归类失败，可手动补关键词）" },
        );
      } else {
        setStatus({
          kind: "err",
          msg:
            res.status === 503
              ? "未配置 DeepSeek key，请前往「设置 → AI 服务配置」保存后重试"
              : (json.message ?? "保存失败"),
        });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (busyId) return;
    if (!window.confirm("删除这条经历？删除后写稿不会再引用它。")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/experiences/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) await refresh();
      else setStatus({ kind: "err", msg: json.message ?? "删除失败" });
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  };

  const startEditKeywords = (item: Experience) => {
    setEditingId(item.id);
    setEditKeywords(item.keywords.join(", "));
  };

  const saveKeywords = async (id: string) => {
    if (busyId) return;
    const keywords = editKeywords
      .split(/[,，\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
      .slice(0, 5);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/experiences/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      const json = await res.json();
      if (json.success) {
        setEditingId(null);
        await refresh();
      } else {
        setStatus({ kind: "err", msg: json.message ?? "保存失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="panel settings-card wide ai-provider-settings-card">
      <div className="settings-icon">▤</div>
      <div>
        <h2>个人经历库</h2>
        <p>
          记下你真实做过的事、翻过的车、被刷新的认知。写稿时会按主题自动检索，
          优先用你自己的故事而不是网上搜来的案例。
        </p>

        <div className="field full">
          <span>随手记一笔</span>
          <textarea
            className="large"
            value={draft}
            maxLength={CONTENT_MAX_LEN}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例：上周用 Claude 写小红书文案连续翻车三次，最后发现是没给它看过往爆款做参照"
          />
          <div className="ai-provider-form-actions">
            <button
              type="button"
              className="ai-button small"
              disabled={saving || draft.trim().length === 0}
              onClick={handleAdd}
            >
              {saving ? "记录中…" : "记下来"}
            </button>
            <small className="field-hint">
              {draft.length}/{CONTENT_MAX_LEN}
            </small>
            {status.kind === "ok" ? (
              <span className="ai-provider-status ok">{status.msg}</span>
            ) : null}
            {status.kind === "err" ? (
              <span className="ai-provider-status err">{status.msg}</span>
            ) : null}
          </div>
        </div>

        {items === null ? (
          <p className="field-hint">加载中…</p>
        ) : items.length === 0 ? (
          <p className="field-hint">
            还没有经历记录。记下你的真实经历，写稿时会优先用你自己的故事。
          </p>
        ) : (
          <ul className="ai-provider-list">
            {items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.topic || "未分类"}
                    {kindLabel(item.kind) ? (
                      <em className="ai-provider-default-badge">{kindLabel(item.kind)}</em>
                    ) : null}
                  </strong>
                  <div>{item.content}</div>
                  {editingId === item.id ? (
                    <div className="voice-stance-row">
                      <input
                        value={editKeywords}
                        onChange={(e) => setEditKeywords(e.target.value)}
                        placeholder="检索关键词，逗号分隔（最多 5 个）"
                      />
                      <button
                        type="button"
                        className="text-button"
                        disabled={busyId === item.id}
                        onClick={() => saveKeywords(item.id)}
                      >
                        {busyId === item.id ? "保存中…" : "保存"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <small className="field-hint">
                      关键词: {item.keywords.length > 0 ? item.keywords.join(" / ") : "（无）"}
                      {item.usedCount > 0 ? ` · 已被引用 ${item.usedCount} 次` : ""}
                    </small>
                  )}
                </div>
                <div className="ai-provider-list-actions">
                  {editingId === item.id ? null : (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => startEditKeywords(item)}
                    >
                      改关键词
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busyId === item.id}
                    onClick={() => handleDelete(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
