"use client";

import { useEffect, useState } from "react";
import { AI_PROVIDERS } from "@/lib/constants";

type Config = {
  id: string;
  provider: string;
  modelId: string;
  isDefault: boolean;
  apiKeyMasked: string;
  createdAt: string;
};

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

/**
 * 从 `src/app/settings/page.tsx` 移植——逻辑原样保留 (GET 列表 / POST upsert /
 * DELETE / POST test), 只是把 shadcn Card/Button 表单换成 cockpit 设计系统
 * 里既有的 `.field` / `.secondary-button` / `.text-button` 等 class, 融入
 * settings 视图的 `.panel.settings-card` 网格。
 */
export function AIProviderCard() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(false);

  const [provider, setProvider] = useState<string>(AI_PROVIDERS[0].id);
  const [modelId, setModelId] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [testingId, setTestingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/ai/config");
      const json = await res.json();
      if (json.success) setConfigs(json.data);
      else setStatus({ kind: "err", msg: json.message ?? "加载失败" });
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "idle" });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/ai/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, modelId, apiKey, isDefault }),
      });
      const json = await res.json();
      if (json.success) {
        setApiKey("");
        setStatus({ kind: "ok", msg: "已保存" });
        refresh();
      } else {
        setStatus({ kind: "err", msg: json.message ?? "保存失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该配置?")) return;
    await fetch(`/api/v1/ai/config/${id}`, { method: "DELETE" });
    refresh();
  };

  const handleTest = async (id: string, provider: string) => {
    // T5 七期: 连通性测试路由 (/api/v1/ai/config/test) 目前只实现了 openai 的
    // chat.completions 探测——deepseek/gpt-image 打过去只会拿到路由那句
    // "暂仅支持测试 openai" 的兜底拒绝, 文案生硬、容易被误读成保存失败 (这不是
    // 生图新引入的问题, deepseek 用户此前测试同样会撞上这句话)。这里前端直接
    // 短路: 非 openai 的配置不发请求, 直接给一句面向用户的友好提示, 引导去
    // 实际生成流程里验证, 而不是在这个通用测试按钮上硬凑一个它本来就不支持
    // 的能力。
    if (provider !== "openai") {
      setStatus({ kind: "ok", msg: "该服务商暂不支持在线连通性测试，保存后可在实际生成时验证是否可用" });
      return;
    }
    setTestingId(id);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/v1/ai/config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ configId: id }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus({ kind: "ok", msg: `连通成功: ${json.data.model}` });
      } else {
        setStatus({ kind: "err", msg: json.message ?? "测试失败" });
      }
    } catch (err) {
      setStatus({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestingId(null);
    }
  };

  return <div className="panel settings-card wide ai-provider-settings-card">
    <div className="settings-icon">✦</div>
    <div>
      <h2>AI 服务配置</h2>
      <p>配置 AI 服务商（文本 / 生图）API Key；密钥使用 AES-256-GCM 加密后存入数据库，前端不会回显明文。</p>
      <form className="ai-provider-form" onSubmit={handleSave}>
        <div className="form-grid">
          <label className="field">
            <span>服务商</span>
            <select
              value={provider}
              onChange={(e) => {
                const next = e.target.value;
                setProvider(next);
                const p = AI_PROVIDERS.find((x) => x.id === next);
                if (p) setModelId(p.defaultModel);
              }}
            >
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>模型 ID</span>
            <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o-mini" required />
          </label>
        </div>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
            autoComplete="off"
          />
        </label>
        <label className="ai-provider-default-toggle">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span>设为默认</span>
        </label>
        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>

      {loading
        ? <p className="goal-empty-copy">加载中...</p>
        : configs.length === 0
          ? <p className="goal-empty-copy">暂无配置</p>
          : <ul className="ai-provider-list">
            {configs.map((c) => <li key={c.id}>
              <div>
                <strong>{c.provider}{c.isDefault ? <em className="ai-provider-default-badge">默认</em> : null}</strong>
                <small>{c.modelId} · {c.apiKeyMasked}</small>
              </div>
              <div className="ai-provider-list-actions">
                <button type="button" className="text-button" disabled={testingId === c.id} onClick={() => handleTest(c.id, c.provider)}>{testingId === c.id ? "测试中…" : "测试"}</button>
                <button type="button" className="text-button danger" onClick={() => handleDelete(c.id)}>删除</button>
              </div>
            </li>)}
          </ul>}
    </div>
  </div>;
}
