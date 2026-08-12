"use client";

import { percent, todayISO } from "@/lib/cockpit/calculations";
import type { CreatorProfile, GoalCycle } from "@/lib/cockpit/model";

export const date = todayISO();

export function shiftDate(value: string, days: number) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export function dashboardTitle(profile: CreatorProfile) {
  return profile.dashboardTitle.trim() || `${profile.creatorName.trim() || "我的"}的自媒体 Dashboard`;
}

export function creatorMark(profile: CreatorProfile) {
  const name = profile.creatorName.trim();
  return name ? Array.from(name)[0].toUpperCase() : "造";
}

export function normalizeGoalQuotas(outputTarget: number, quotas: GoalCycle["quotas"]) {
  const target = Math.max(0, outputTarget || 0);
  const assigned = quotas.filter((item) => item.contentType !== "其他");
  const assignedTotal = assigned.reduce((sum, item) => sum + Math.max(0, item.target || 0), 0);
  const unallocated = Math.max(0, target - assignedTotal);
  return unallocated ? [...assigned, { contentType: "其他", target: unallocated }] : assigned;
}

export function ProgressBar({ value, tone = "clay" }: { value: number; tone?: "clay" | "olive" | "ink" }) {
  return <div className="progress-track"><span className={`progress-fill ${tone}`} style={{ width: percent(value) }} /></div>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-mark">＋</div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

export function Badge({ children, tone = "neutral", color }: { children: React.ReactNode; tone?: string; color?: string }) {
  return <span
    className={`badge badge-${tone}${color ? " badge-stage-custom" : ""}`}
    style={color ? { "--badge-color": color } as React.CSSProperties : undefined}
  >{children}</span>;
}

export function EditablePageTitle({ value, fallback, onChange }: { value: string; fallback: string; onChange: (value: string) => void }) {
  return <label className="editable-page-title">
    <input
      value={value}
      placeholder={fallback}
      aria-label="页面主标题"
      title="点击修改页面标题"
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        const normalized = event.target.value.trim();
        onChange(normalized || fallback);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
    <span>点击修改</span>
  </label>;
}

export function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = { inspiration: "✣", momentum: "◫", schedule: "▤", pipeline: "▦", goals: "◎", analytics: "◎", review: "◌", settings: "⚙", plus: "＋", search: "⌕", spark: "✦", arrow: "→", backup: "⇩", version: "↻", platform: "▸", radar: "◉" };
  return <span aria-hidden="true" className="icon">{icons[name] ?? "·"}</span>;
}

export function StarRating({ value, onChange, compact = false }: { value: number; onChange?: (value: number) => void; compact?: boolean }) {
  const rating = Math.max(0, Math.min(5, Math.round(value || 0)));
  const labels = ["未评价", "不理想", "偏弱", "一般", "不错", "代表作"];
  return <div className={compact ? "star-rating compact" : "star-rating"} role={onChange ? "radiogroup" : "img"} aria-label={rating ? `${rating} 星，${labels[rating]}` : "尚未评价"}>
    <div>{[1, 2, 3, 4, 5].map((star) => onChange
      ? <button type="button" key={star} className={star <= rating ? "active" : ""} onClick={() => onChange(star)} role="radio" aria-checked={rating === star} aria-label={`${star} 星`}>★</button>
      : <span key={star} className={star <= rating ? "active" : ""} aria-hidden="true">★</span>)}</div>
    {!compact ? <span>{rating ? `${rating} 星 · ${labels[rating]}` : "点击星星完成定型评价"}</span> : null}
  </div>;
}
