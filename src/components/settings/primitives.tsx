'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 设置页共用原语。
 *
 * 设置页一律**显式保存**, 和模板编辑器同一个理由: 这些接口收的是整份档案
 * (整体校验、整体替换), 不是补丁。自动保存等于每敲一个字符整体替换一次,
 * 中间任何一次请求出错或乱序到达, 覆盖掉的是整份档案。
 */

export const inputCls =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed ' +
  'placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/70">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * 可增删的条目列表(内容支柱、立场、痛点…)。
 *
 * 这些字段在 schema 里都有条数上限, 到顶时**把上限说出来**而不是让「加一条」
 * 点了没反应 —— 按钮没反应会被当成坏了。
 */
export function ItemList<T>({
  items,
  onChange,
  max,
  empty,
  addLabel,
  make,
  render,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  max: number;
  empty: string;
  addLabel: string;
  make: () => T;
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{empty}</p>
      ) : (
        items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {render(item, (patch) =>
                onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))),
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-2 shrink-0 text-xs text-muted-foreground hover:text-destructive"
            >
              删除
            </button>
          </div>
        ))
      )}
      {items.length < max ? (
        <button
          type="button"
          onClick={() => onChange([...items, make()])}
          className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {addLabel}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground/60">最多 {max} 条，已满。</p>
      )}
    </div>
  );
}

/** 底部常驻保存条 —— 设置页都很长, 改完要往回滚才能保存是最容易丢改动的形状。 */
export function SaveBar({
  dirty,
  busy,
  error,
  onSave,
  extra,
}: {
  dirty: boolean;
  busy: boolean;
  error: string;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-10 flex items-center justify-between gap-4 border-t border-border bg-background/95 px-10 py-3 backdrop-blur">
      <div className="min-w-0 text-xs">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : dirty ? (
          <span className="text-muted-foreground">有未保存的改动</span>
        ) : (
          <span className="text-muted-foreground/60">已是最新</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
          {busy ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  );
}

/** 一份档案的保存状态机。所有设置子页共用同一套语义。 */
export function useSaved<T>(initial: T, url: string, method: 'PUT' | 'POST' = 'PUT') {
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '保存失败');
        return;
      }
      setSaved(value);
    } catch {
      setError('保存失败，请检查网络');
    } finally {
      setBusy(false);
    }
  }

  return { value, setValue, dirty, busy, error, setError, save };
}

export function StatusDot({ ok, className }: { ok: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        ok ? 'bg-foreground/70' : 'bg-destructive/60',
        className,
      )}
    />
  );
}
