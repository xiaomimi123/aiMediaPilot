"use client";

import { ACT_LABELS, type ScriptAct } from "@/lib/script/six-act";
import { buildActGuideRows } from "@/lib/cockpit/six-act-guide";

export function SixActGuidePanel({ acts, progress, onToggle, mode }: {
  acts: ScriptAct[];
  progress: Record<string, boolean> | undefined;
  onToggle: (actKey: string, done: boolean) => void;
  mode: "recording" | "editing";
}) {
  const rows = buildActGuideRows(acts, progress);
  return <div className="six-act-guide-panel">
    {rows.map(({ act, done }) => {
      const beats = Array.isArray(act.beats) ? act.beats : [];
      return <div key={act.act} className={`six-act-guide-card ${done ? "done" : ""}`}>
        <div className="script-section-head">
          <strong>{ACT_LABELS[act.act] ?? act.act}{typeof act.targetSec === "number" ? ` · ${act.targetSec}s` : ""}</strong>
        </div>
        <p className="script-section-text">{act.narration}</p>
        {act.visual ? <p className="script-act-meta"><span>配图建议：</span>{act.visual}</p> : null}
        {act.note ? <p className="script-act-meta"><span>备注：</span>{act.note}</p> : null}
        {beats.length > 0 ? <div className="script-act-beats">{beats.map((beat, idx) => <span key={idx} className="script-act-chip">{beat.keyword}</span>)}</div> : null}
        <label className="six-act-guide-checkbox"><input type="checkbox" checked={done} onChange={(e) => onToggle(act.act, e.target.checked)} />{mode === "recording" ? "这一幕录完了" : "这一幕剪完了"}</label>
      </div>;
    })}
  </div>;
}
