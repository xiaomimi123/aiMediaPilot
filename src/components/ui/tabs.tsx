'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 极简 tabs。没装 radix, 这里只要"切换显示哪一块"这一个能力, 不引依赖。
 * 每个 tab 的内容由调用方按当前值自己渲染 —— 组件不持有内容, 只持有当前值。
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 rounded-md bg-secondary p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          disabled={t.disabled}
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40',
            value === t.value
              ? 'bg-background font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 受控值的 hook —— 页面不需要为一个 tab 状态单独想变量名。 */
export function useTabs<T extends string>(initial: T) {
  return useState<T>(initial);
}
