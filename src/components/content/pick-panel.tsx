'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  emptyPicked,
  isReady,
  checkedCount,
  totalRequiredCount,
  REQUIRED_SECTIONS_BY_PLATFORM,
  SECTION_LABELS,
  type Platform,
  type PickedState,
} from '@/lib/script-picked/types';

interface Props {
  draftId: string;
  platform: Platform;
  // We only need titles/hooks lists for selectors; pass minimal info
  titles: { text: string }[];
  hooks?: { text: string }[];  // douyin only
  initial: PickedState | null;
}

export function PickPanel({ draftId, platform, titles, hooks, initial }: Props) {
  const [state, setState] = useState<PickedState>(initial ?? emptyPicked());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = isReady(platform, state);
  const checked = checkedCount(platform, state);
  const total = totalRequiredCount(platform);

  // Auto-save with 500ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/scripts/${draftId}/picked`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(state),
        });
        const json = await res.json();
        if (!json.success) setError(json.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const required = REQUIRED_SECTIONS_BY_PLATFORM[platform];

  return (
    <Card className={cn('border-2', ready ? 'border-green-400 bg-green-50/30' : 'border-amber-300 bg-amber-50/30')}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            {ready ? '✅ 准备好复制走了' : `📋 发布前选定 (${checked}/${total})`}
          </h3>
          <span className="text-xs text-muted-foreground">{saving ? '保存中...' : ''}</span>
        </div>

        {/* Title chooser */}
        <div className="space-y-1.5">
          <Label>1. 选定标题</Label>
          <div className="space-y-1">
            {titles.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setState((s) => ({ ...s, titleIdx: i }))}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors',
                  state.titleIdx === i
                    ? 'border-green-500 bg-green-50'
                    : 'border-border hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                    state.titleIdx === i ? 'border-green-600 bg-green-600' : 'border-border',
                  )}
                />
                <span>
                  <span className="font-mono text-xs text-muted-foreground">候选 {i + 1}</span>{' '}
                  {t.text}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Hook chooser (douyin only) */}
        {platform === 'douyin' && hooks && (
          <div className="space-y-1.5">
            <Label>2. 选定钩子 (开场 0-3s 用)</Label>
            <div className="space-y-1">
              {hooks.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, hookIdx: i }))}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors',
                    state.hookIdx === i
                      ? 'border-green-500 bg-green-50'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                      state.hookIdx === i ? 'border-green-600 bg-green-600' : 'border-border',
                    )}
                  />
                  <span>
                    <span className="font-mono text-xs text-muted-foreground">候选 {i + 1}</span>{' '}
                    &ldquo;{h.text}&rdquo;
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Section checkboxes */}
        <div className="space-y-1">
          <Label>{platform === 'douyin' ? '3' : '2'}. 各部分准备 OK</Label>
          {required.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  reviewed: { ...s.reviewed, [key]: !s.reviewed[key] },
                }))
              }
              className="flex w-full items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent/50"
            >
              <span
                className={cn(
                  'h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center text-xs transition-colors',
                  state.reviewed[key]
                    ? 'border-green-600 bg-green-600 text-white'
                    : 'border-border bg-background',
                )}
              >
                {state.reviewed[key] ? '✓' : ''}
              </span>
              <span className={cn('text-sm', state.reviewed[key] && 'text-muted-foreground line-through')}>
                {SECTION_LABELS[key] ?? key} 已准备
              </span>
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {ready && (
          <div className="rounded-md bg-green-100 p-3 text-sm text-green-900">
            ✅ 所有选定就绪 — 复制对应区块去 {PLATFORM_NAME[platform]} 发吧
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PLATFORM_NAME: Record<Platform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  gongzhonghao: '公众号',
};

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium">{children}</div>;
}
