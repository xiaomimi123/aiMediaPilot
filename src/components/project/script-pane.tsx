'use client';

import { useEffect, useState } from 'react';
import { ROLE_LABEL } from '@/lib/script/model';
import type { ProjectView } from '@/lib/project/view';
import { PredictionPanel } from './prediction-panel';
import { PolishPanel } from './polish-panel';
import type { PolishResult } from '@/lib/script/polish';
import type { Script } from '@/lib/script/model';
import { cn } from '@/lib/utils';

export function ScriptPane({
  project,
  highlighted,
  onEdit,
  onFinalize,
  onReplace = async () => {},
  onHighlight = () => {},
  onAskEditor = () => {},
  onPredictionChanged = () => {},
  quoted = null,
  predictionKey,
}: {
  project: ProjectView;
  highlighted: Set<string>;
  onEdit: (segmentId: string, text: string) => Promise<void>;
  onFinalize: () => Promise<void>;
  /** 整篇替换(润色后「用润色版」) */
  onReplace?: (script: Script, note: string) => Promise<void>;
  onHighlight?: (segmentId: string) => void;
  onAskEditor?: (text: string) => void;
  onPredictionChanged?: () => void;
  /** 预测里被点的原句所在段落: 标「依据」并滚过去 */
  quoted?: string | null;
  predictionKey?: string | number;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [polished, setPolished] = useState<PolishResult | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishErr, setPolishErr] = useState<string | null>(null);
  useEffect(() => {
    if (quoted) document.getElementById(`seg-${quoted}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [quoted]);

  if (!project.script || !project.report) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-secondary)]">
        还没有稿子。在右边告诉编导这条想讲什么。
      </div>
    );
  }
  const { script, report } = project;

  async function polish() {
    setPolishing(true);
    setPolishErr(null);
    const j = await fetch('/api/scripts/polish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: script.segments.map((s) => s.text).join('\n'), targetSec: project.targetSec }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setPolishing(false);
    if (!j.success) return setPolishErr(j.message);
    setPolished(j.data);
  }

  async function usePolished(p: PolishResult) {
    setPolishing(true);
    const what = p.changes.slice(0, 3).map((c) => c.what).join('；');
    await onReplace(p.script, `稿子换成了润色版（改动 ${p.changes.length} 处${what ? `：${what}` : ''}）`);
    setPolishing(false);
    setPolished(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-6 py-3 text-sm">
        <span className={cn('font-mono', report.ok ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
          约 {report.totalSec} 秒 / 目标 {report.targetSec} 秒
        </span>
        <div className="flex-1" />
        {project.stage === 'draft' && (
          <button className="btn-secondary" disabled={polishing} onClick={() => void polish()}>
            {polishing && !polished ? '正在润色…' : '润色'}
          </button>
        )}
        {project.stage === 'draft' ? (
          <button
            className="btn-primary"
            onClick={() => void onFinalize()}
          >
            {report.ok ? '定稿' : '时长还超，仍然定稿'}
          </button>
        ) : (
          <span className="text-[var(--text-secondary)]">已定稿 · 去「口播」录制</span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {polishErr && <p className="text-sm text-[var(--danger)]">{polishErr}</p>}
        {polished && <PolishPanel result={polished} useLabel="用润色版" keepLabel="保留原文" busy={polishing} onUse={() => void usePolished(polished)} onKeep={() => setPolished(null)} />}
        <PredictionPanel projectId={project.id} reloadKey={predictionKey} onHighlight={onHighlight} onAskEditor={onAskEditor} onChanged={onPredictionChanged} />
        {script.segments.map((s, i) => {
          const r = report.segments[i];
          const isEditing = editing === s.id;
          return (
            <div
              key={s.id}
              id={`seg-${s.id}`}
              className={cn(
                'rounded-lg border p-4',
                highlighted.has(s.id)
                  ? 'border-[var(--warning)] bg-[var(--warning-subtle)]'
                  : quoted === s.id
                    ? 'border-[var(--accent)] bg-[var(--bg-surface)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
              )}
            >
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="font-medium text-[var(--text-primary)]">{ROLE_LABEL[s.role]}</span>
                {highlighted.has(s.id) && <span className="text-[var(--warning)]">刚改</span>}
                {quoted === s.id && !highlighted.has(s.id) && <span className="text-[var(--accent)]">依据</span>}
                <div className="flex-1" />
                <span className={cn('font-mono', r.over ? 'text-[var(--warning)]' : 'text-[var(--text-tertiary)]')}>
                  {r.over ? `${r.estSec} / ${r.budgetSec} 秒 · 偏长` : `${r.estSec} / ${r.budgetSec} 秒`}
                </span>
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    className="h-32 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] p-2 text-sm"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex gap-2 text-sm">
                    <button
                      className="btn-primary"
                      onClick={async () => {
                        await onEdit(s.id, draft);
                        setEditing(null);
                      }}
                    >
                      保存
                    </button>
                    <button className="px-3 py-1 text-[var(--text-secondary)]" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="cursor-text whitespace-pre-wrap text-[15px] leading-7"
                  title="点击直接修改"
                  onClick={() => {
                    setEditing(s.id);
                    setDraft(s.text);
                  }}
                >
                  {s.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
