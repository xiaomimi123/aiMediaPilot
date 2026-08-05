"use client";

import { useState } from "react";
import { MIN_RETROS_FOR_MEDIAN } from "@/lib/settings/baseline-stats";

const SOURCE_LABEL = {
  null: "尚未设置",
  onboarding: "你 onboarding 填的",
  "retro-median": "自动从复盘 median 算出",
} as const;

/**
 * 从 `src/app/settings/baseline/page.tsx` + `src/components/settings/baseline-form.tsx`
 * 移植——两处原本一个是 server component (拿 baselinePlays/retroMedian/retroCount),
 * 一个是纯表单; 这里合并成一张卡, 数据来自 cockpit extras.settings (由
 * `loadExtras` 服务端算好一起下发, 不用再单独 fetch)。
 */
export function BaselineCard({
  baselinePlays,
  retroMedian,
  retroCount,
}: {
  baselinePlays: string | null;
  retroMedian: number | null;
  retroCount: number;
}) {
  const [inputValue, setInputValue] = useState<string>(baselinePlays ?? "");
  const [saved, setSaved] = useState<string | null>(baselinePlays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentLabel = saved === null
    ? SOURCE_LABEL.null
    : retroMedian !== null && Math.round(retroMedian) === Number(saved)
      ? SOURCE_LABEL["retro-median"]
      : SOURCE_LABEL.onboarding;

  const handleSave = async () => {
    setMessage(null);
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMessage({ type: "error", text: "请填一个 > 0 的数字" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/user/baseline", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: parsed }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage({ type: "error", text: json.message });
      } else {
        setSaved(json.data.baselinePlays);
        setMessage({ type: "success", text: `已保存: ${json.data.baselinePlays}` });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("确认清空 baseline? 之后 L1 预测会回到冷启动态。")) return;
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/v1/user/baseline", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: null }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage({ type: "error", text: json.message });
      } else {
        setInputValue("");
        setSaved(null);
        setMessage({ type: "success", text: "已清空, 回到冷启动态" });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleUseAuto = () => {
    if (retroMedian !== null) setInputValue(retroMedian.toString());
  };

  return <div className="panel settings-card baseline-settings-card">
    <div className="settings-icon">◎</div>
    <div>
      <h2>内容基准 (Baseline)</h2>
      <p>
        L1 预测的核心输入：表达你账号“一条普通视频通常多少播放”。
        当前: <b>{saved ?? "—"}</b>{saved !== null ? " 播放/视频" : ""} ({currentLabel})
      </p>
      {retroMedian !== null ? <p className="baseline-auto-hint">
        📊 自动计算 (基于 {retroCount} 条复盘 median): <b>{retroMedian}</b>
        <button type="button" className="text-button" onClick={handleUseAuto} disabled={saving}>用自动值</button>
      </p> : null}
      <div className="form-grid">
        <label className="field">
          <span>播放数 (1 - 1e8)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="例如: 800"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>
      <div className="ai-provider-form-actions">
        <button type="button" className="secondary-button" disabled={saving || inputValue.trim() === ""} onClick={handleSave}>{saving ? "保存中..." : "保存"}</button>
        <button type="button" className="text-button" disabled={saving} onClick={handleClear}>清空 (回到冷启动)</button>
      </div>
      {message ? <p className={message.type === "success" ? "ai-provider-status ok" : "ai-provider-status err"}>{message.text}</p> : null}
      {retroCount >= MIN_RETROS_FOR_MEDIAN ? <p className="baseline-override-hint">
        💡 ≥{MIN_RETROS_FOR_MEDIAN} 条复盘时, 新分析自动用 retro median, 这里写的值会在下次复盘时被覆盖。
      </p> : null}
    </div>
  </div>;
}
