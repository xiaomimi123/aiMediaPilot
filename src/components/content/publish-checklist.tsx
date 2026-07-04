'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  emptyChecklist,
  isReady,
  needsHookRewrite,
  type PublishChecklistState,
} from '@/lib/checklist/types';
import type { ContentPlatform } from '@/lib/platform';

interface TitleFeedback {
  lengthVerdict: 'good' | 'short' | 'long';
  hookTypes: string[];
  suggestions: string[];
  overallScore: number;
}

interface Props {
  analysisId: string;
  niche: string;
  platform?: ContentPlatform;
  hookScore: number | null;
  topActionItems: string[];
  initial: PublishChecklistState | null;
}

export function PublishChecklist({ analysisId, niche, platform = 'douyin', hookScore, topActionItems, initial }: Props) {
  const [state, setState] = useState<PublishChecklistState>(initial ?? emptyChecklist());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // M: title feedback state
  const [titleFeedback, setTitleFeedback] = useState<TitleFeedback | null>(null);
  const [titleFeedbackLoading, setTitleFeedbackLoading] = useState(false);
  const [titleFeedbackError, setTitleFeedbackError] = useState<string | null>(null);
  const titleAbortRef = useRef<AbortController | null>(null);

  const ready = isReady({ state, hookScore });
  const needsHook = needsHookRewrite(hookScore);

  // M: debounced LLM critique of finalTitle (1.5s)
  useEffect(() => {
    const title = state.finalTitle.trim();
    if (title.length < 3) {
      setTitleFeedback(null);
      setTitleFeedbackError(null);
      return;
    }
    titleAbortRef.current?.abort();
    const controller = new AbortController();
    titleAbortRef.current = controller;
    const timer = setTimeout(async () => {
      setTitleFeedbackLoading(true);
      setTitleFeedbackError(null);
      try {
        const res = await fetch('/api/v1/checklist/title-feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, niche, platform }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!json.success) {
          setTitleFeedbackError(json.message);
          setTitleFeedback(null);
        } else {
          setTitleFeedback(json.data as TitleFeedback);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setTitleFeedbackError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setTitleFeedbackLoading(false);
      }
    }, 1500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.finalTitle, niche, platform]);

  // Auto-save (debounce 500ms)
  useEffect(() => {
    if (!initial && state === emptyChecklist()) return; // skip initial render
    const timer = setTimeout(() => {
      void persist();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const persist = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/content/analyses/${analysisId}/checklist`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage({ type: 'error', text: json.message });
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggleActionItem = (idx: number) => {
    setState((s) => ({
      ...s,
      actionItemsAdopted: s.actionItemsAdopted.includes(idx)
        ? s.actionItemsAdopted.filter((i) => i !== idx)
        : [...s.actionItemsAdopted, idx],
    }));
  };

  return (
    <Card className={cn('border-2', ready ? 'border-green-400 bg-green-50/30' : 'border-amber-300 bg-amber-50/30')}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            {ready ? '✅ 可以发了' : '📋 发前 checklist'}
          </h3>
          <span className="text-xs text-muted-foreground">
            {saving ? '保存中...' : initial?.completedAt ? '上次保存成功' : ''}
          </span>
        </div>

        <CheckRow
          checked={state.reviewedHook}
          label="看完了「钩子」诊断"
          onToggle={() => setState((s) => ({ ...s, reviewedHook: !s.reviewedHook }))}
        />
        <CheckRow
          checked={state.reviewedRetention}
          label="看完了「完播」诊断"
          onToggle={() => setState((s) => ({ ...s, reviewedRetention: !s.reviewedRetention }))}
        />
        <CheckRow
          checked={state.reviewedTitleCaption}
          label="看完了「标题/文案」诊断"
          onToggle={() => setState((s) => ({ ...s, reviewedTitleCaption: !s.reviewedTitleCaption }))}
        />
        <CheckRow
          checked={state.reviewedCover}
          label="看完了「封面」诊断"
          onToggle={() => setState((s) => ({ ...s, reviewedCover: !s.reviewedCover }))}
        />

        <div className="space-y-1">
          <Label htmlFor="final-title">最终标题 (从 3 候选挑或自填)</Label>
          <Input
            id="final-title"
            value={state.finalTitle}
            onChange={(e) => setState((s) => ({ ...s, finalTitle: e.target.value }))}
            placeholder="发抖音时实际用的标题"
          />
          {titleFeedbackLoading && (
            <p className="text-xs text-muted-foreground">🤖 AI 评估中...</p>
          )}
          {titleFeedbackError && (
            <p className="text-xs text-destructive">评估失败: {titleFeedbackError}</p>
          )}
          {titleFeedback && !titleFeedbackLoading && (
            <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 font-semibold', titleFeedback.lengthVerdict === 'good' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900')}>
                  {titleFeedback.lengthVerdict === 'good' ? '✓ 字数合适' : titleFeedback.lengthVerdict === 'short' ? '⚠ 太短' : '⚠ 太长'}
                </span>
                <span className="text-muted-foreground">综合 {titleFeedback.overallScore}/100</span>
                {titleFeedback.hookTypes.length > 0 && (
                  <span className="text-muted-foreground">钩子: {titleFeedback.hookTypes.join(' · ')}</span>
                )}
              </div>
              {titleFeedback.suggestions.length > 0 && (
                <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                  {titleFeedback.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="final-cover">最终封面方案 (note)</Label>
          <Input
            id="final-cover"
            value={state.finalCoverNote}
            onChange={(e) => setState((s) => ({ ...s, finalCoverNote: e.target.value }))}
            placeholder="例: 用候选 2 / 重拍 / Photoshop 改文字"
          />
        </div>

        {needsHook && (
          <div className="space-y-1 rounded-md border-2 border-red-300 bg-red-50/30 p-3">
            <Label htmlFor="rewrite-hook" className="text-red-800">
              ⚠️ 钩子 score &lt; 70, 重写钩子文案 (必填)
            </Label>
            <Input
              id="rewrite-hook"
              value={state.rewrittenHook ?? ''}
              onChange={(e) => setState((s) => ({ ...s, rewrittenHook: e.target.value }))}
              placeholder="新钩子: 例 '你每天浪费 3 小时这事不知道吧'"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>至少采纳 1 条 AI 建议</Label>
          {topActionItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">(此 analysis 无 topActionItems)</p>
          ) : (
            <ul className="space-y-1.5">
              {topActionItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => toggleActionItem(idx)}
                    className={cn(
                      'mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                      state.actionItemsAdopted.includes(idx)
                        ? 'border-green-600 bg-green-600 text-white'
                        : 'border-border bg-background',
                    )}
                    aria-label={`采纳建议 ${idx + 1}`}
                  >
                    {state.actionItemsAdopted.includes(idx) && '✓'}
                  </button>
                  <span className={cn('text-sm', state.actionItemsAdopted.includes(idx) && 'line-through text-muted-foreground')}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && (
          <p className={cn('text-xs', message.type === 'success' ? 'text-green-700' : 'text-destructive')}>
            {message.text}
          </p>
        )}

        {ready && (
          <div className="rounded-md bg-green-100 p-3 text-sm text-green-900">
            ✅ 所有 checklist 已满足 — 可以放心发了
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CheckRow({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-md p-1 text-left hover:bg-accent/50"
    >
      <span
        className={cn(
          'h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
          checked ? 'border-green-600 bg-green-600 text-white' : 'border-border bg-background',
        )}
      >
        {checked && '✓'}
      </span>
      <span className={cn('text-sm', checked && 'text-muted-foreground line-through')}>{label}</span>
    </button>
  );
}
