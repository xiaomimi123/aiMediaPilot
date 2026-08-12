"use client";

import { useEffect, useState } from "react";

type RadarConfig = { hasKey: boolean; dailyLimit: number; enabled: boolean };

type Keyword = { id: string; text: string; status: "active" | "candidate" | "ignored"; source: string };
type KeywordGroups = { active: Keyword[]; candidate: Keyword[]; ignored: Keyword[] };

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

/**
 * 「雷达配置」设置卡 — 样式循 `ai-provider-card.tsx` 先例（同一套 `.field` /
 * `.form-grid` / `.secondary-button` / `.ai-provider-status` / `.ai-provider-list`
 * 体系），逻辑对应 T5 三个 API：`GET/PUT /api/v1/radar/config`（Tavily key + 每日
 * 上限 + 开关）与 `GET /api/v1/radar/keywords` + `PATCH .../[id]` + `POST
 * /api/v1/radar/keywords`（关键词管理）。候选词 (`status:'candidate'`) 不在这张卡
 * 管——那是雷达视图页顶「候选词审批条」的职责（见 `views/radar.tsx`），这里只管理
 * 用户已确认的 active/ignored 两组，避免同一份数据在两处都能操作、状态来源分裂。
 */
export function RadarConfigCard() {
  const [config, setConfig] = useState<RadarConfig | null>(null);
  const [tavilyKey, setTavilyKey] = useState("");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [keywords, setKeywords] = useState<KeywordGroups | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [keywordStatus, setKeywordStatus] = useState<Status>({ kind: "idle" });
  const [keywordPending, setKeywordPending] = useState<Set<string>>(new Set());

  const refreshConfig = async () => {
    try {
      const res = await fetch("/api/v1/radar/config");
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setDailyLimit(String(json.data.dailyLimit));
        setEnabled(json.data.enabled);
      } else {
        setStatus({ kind: "err", msg: json.message ?? "加载失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const refreshKeywords = async () => {
    try {
      const res = await fetch("/api/v1/radar/keywords");
      const json = await res.json();
      if (json.success) setKeywords(json.data);
      else setKeywordStatus({ kind: "err", msg: json.message ?? "加载失败" });
    } catch (err) {
      setKeywordStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    refreshConfig();
    refreshKeywords();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "idle" });
    const parsedLimit = Number(dailyLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      setStatus({ kind: "err", msg: "每日上限需为正整数" });
      return;
    }
    setSaving(true);
    try {
      const body: { tavilyKey?: string; dailyLimit: number; enabled: boolean } = {
        dailyLimit: parsedLimit,
        enabled,
      };
      if (tavilyKey.trim()) body.tavilyKey = tavilyKey.trim();
      const res = await fetch("/api/v1/radar/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setDailyLimit(String(json.data.dailyLimit));
        setEnabled(json.data.enabled);
        setTavilyKey("");
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

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newKeyword.trim();
    if (!text) return;
    setKeywordStatus({ kind: "idle" });
    setAddingKeyword(true);
    try {
      const res = await fetch("/api/v1/radar/keywords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (json.success) {
        setNewKeyword("");
        setKeywordStatus({ kind: "ok", msg: `已添加「${text}」` });
        refreshKeywords();
      } else {
        // 409 (重复关键词) 与其余错误共用同一条展示路径 — API message 已经是
        // 面向用户的完整文案 ('该关键词已存在'), 不需要按状态码分支改写。
        setKeywordStatus({ kind: "err", msg: json.message ?? "添加失败" });
      }
    } catch (err) {
      setKeywordStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleToggleKeyword = async (id: string, nextStatus: "active" | "ignored") => {
    if (keywordPending.has(id)) return;
    setKeywordPending((prev) => new Set(prev).add(id));
    setKeywordStatus({ kind: "idle" });
    try {
      const res = await fetch(`/api/v1/radar/keywords/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (json.success) {
        refreshKeywords();
      } else {
        setKeywordStatus({ kind: "err", msg: json.message ?? "操作失败" });
      }
    } catch (err) {
      setKeywordStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setKeywordPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return <div className="panel settings-card wide radar-config-card">
    <div className="settings-icon">◉</div>
    <div>
      <h2>雷达配置</h2>
      <p>热点雷达按你的行业关键词全网深读，逐篇 AI 阅读评分后汇总成热度排行。Tavily key 用于搜索，AI 阅读复用「AI 服务配置」里配置的服务商；两者都要配好雷达才能跑。</p>
      <form className="ai-provider-form" onSubmit={handleSave}>
        <div className="form-grid">
          <label className="field">
            <span>Tavily API Key{config?.hasKey ? <em className="ai-provider-default-badge">已配置</em> : null}</span>
            <input
              type="password"
              value={tavilyKey}
              onChange={(e) => setTavilyKey(e.target.value)}
              placeholder={config?.hasKey ? "已配置，留空则不修改" : "tvly-..."}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>每日阅读上限</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <label className="ai-provider-default-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>启用雷达（每日自动扫描 + 「立即扫描」可用）</span>
        </label>
        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>

      <h3 className="radar-keyword-heading">关键词管理</h3>
      <p className="radar-keyword-hint">已启用的关键词才会参与扫描；AI 从高热内容里学到的新词会先进入雷达页顶的候选词审批条，采纳后才会出现在这里。</p>
      <form className="add-type radar-keyword-add" onSubmit={handleAddKeyword}>
        <input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          placeholder="手动添加关键词"
          disabled={addingKeyword}
        />
        <button type="submit" disabled={addingKeyword || !newKeyword.trim()}>{addingKeyword ? "添加中…" : "添加"}</button>
      </form>
      {keywordStatus.kind === "ok" ? <p className="ai-provider-status ok">{keywordStatus.msg}</p> : null}
      {keywordStatus.kind === "err" ? <p className="ai-provider-status err">{keywordStatus.msg}</p> : null}

      {keywords ? <div className="radar-keyword-groups">
        <div>
          <h4>已启用 ({keywords.active.length})</h4>
          {keywords.active.length ? <ul className="ai-provider-list">
            {keywords.active.map((k) => <li key={k.id}>
              <strong>{k.text}</strong>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button" disabled={keywordPending.has(k.id)} onClick={() => handleToggleKeyword(k.id, "ignored")}>停用</button>
              </div>
            </li>)}
          </ul> : <p className="goal-empty-copy">暂无启用的关键词</p>}
        </div>
        <div>
          <h4>已停用 ({keywords.ignored.length})</h4>
          {keywords.ignored.length ? <ul className="ai-provider-list">
            {keywords.ignored.map((k) => <li key={k.id}>
              <strong>{k.text}</strong>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button" disabled={keywordPending.has(k.id)} onClick={() => handleToggleKeyword(k.id, "active")}>启用</button>
              </div>
            </li>)}
          </ul> : <p className="goal-empty-copy">暂无停用的关键词</p>}
        </div>
      </div> : <p className="goal-empty-copy">加载中...</p>}
    </div>
  </div>;
}
