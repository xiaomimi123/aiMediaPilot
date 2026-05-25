'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Ctx = { value: string; onChange: (v: string) => void };
const TabsCtx = createContext<Ctx | null>(null);

export function Tabs({
  value, onValueChange, children, className,
}: { value: string; onValueChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <TabsCtx.Provider value={{ value, onChange: onValueChange }}>
      <div className={cn('flex flex-col gap-2', className)}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('inline-flex gap-1 rounded-md bg-muted p-1', className)}>{children}</div>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsTrigger outside Tabs');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.onChange(value)}
      className={cn(
        'rounded-sm px-3 py-1 text-sm transition-colors',
        active ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsContent outside Tabs');
  if (ctx.value !== value) return null;
  return <div>{children}</div>;
}
