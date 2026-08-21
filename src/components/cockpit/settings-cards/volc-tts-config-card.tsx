"use client";

import { useEffect, useState } from "react";

const DEFAULT_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_VOICE_TYPE = "zh_female_vv_uranus_bigtts";

type Config = {
  hasConfig: boolean;
  resourceId: string;
  voiceType: string;
  apiKeyMasked: string;
};

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

/**
 * 火山 TTS 配置卡 — 样式循 `ai-provider-card.tsx` 先例。与 AI 服务配置卡的区别:
 * 这里是单条记录 (`@@unique([userId])`),没有 provider 维度和列表,只有一份
 * "当前配置" 的读/写。字段形状对应 Task 9 实测的真实契约 (单一 apiKey + 账号
 * 相关的 resourceId + 音色 voiceType),而非 spec 最初假设的 appId/accessToken。
 */
export function VolcTtsConfigCard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID);
  const [voiceType, setVoiceType] = useState(DEFAULT_VOICE_TYPE);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/tts/volc-config");
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setResourceId(json.data.resourceId || DEFAULT_RESOURCE_ID);
        setVoiceType(json.data.voiceType || DEFAULT_VOICE_TYPE);
      } else {
        setStatus({ kind: "err", msg: json.message ?? "加载失败" });
      }
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
      const res = await fetch("/api/v1/tts/volc-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, resourceId, voiceType }),
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

  return <div className="panel settings-card wide volc-tts-config-card">
    <div className="settings-icon">🔊</div>
    <div>
      <h2>火山 TTS 配置</h2>
      <p>配置火山引擎「豆包语音大模型」的 API Key（单一密钥，无需 appid）；密钥使用 AES-256-GCM 加密后存入数据库，前端不会回显明文。</p>
      <form className="ai-provider-form" onSubmit={handleSave}>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasConfig ? config.apiKeyMasked : "36 位 UUID 格式"}
            required
            autoComplete="off"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>资源档位 (resourceId)</span>
            <input value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder={DEFAULT_RESOURCE_ID} />
          </label>
          <label className="field">
            <span>音色 (voiceType)</span>
            <input value={voiceType} onChange={(e) => setVoiceType(e.target.value)} placeholder={DEFAULT_VOICE_TYPE} />
          </label>
        </div>
        <div className="ai-provider-form-actions">
          <button type="submit" className="secondary-button" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          {status.kind === "ok" ? <span className="ai-provider-status ok">{status.msg}</span> : null}
          {status.kind === "err" ? <span className="ai-provider-status err">{status.msg}</span> : null}
        </div>
      </form>

      {loading
        ? <p className="goal-empty-copy">加载中...</p>
        : config?.hasConfig
          ? <p className="goal-empty-copy">当前密钥: {config.apiKeyMasked} · {config.resourceId} · {config.voiceType}</p>
          : <p className="goal-empty-copy">暂无配置</p>}
    </div>
  </div>;
}
