import { cn } from '@/lib/utils';

/**
 * 页面外壳。**有 PageShell 的是页面, 没有的是区块** —— 这是硬规则(5.4):
 * 不允许用 embedded/compact/standalone 这类 prop 让一个组件在两种身份间切换,
 * 需要那种 prop 时拆成两个组件。旧版 content-detail.tsx 就是这么长到 1000+ 行的。
 */
export function PageShell({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('flex-1 overflow-y-auto', className)}>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
