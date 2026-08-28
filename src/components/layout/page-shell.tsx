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
      <div className="mx-auto max-w-5xl px-10 py-12">
        {/*
          页头是一块「刊头」: 衬线标题 + 下面一条规线。规线不是装饰 —— 它把页头和
          正文切开, 这个工具的每一页正文都是密集信息, 没有这条线会糊成一片。
        */}
        <header className="mb-9 border-b border-foreground/10 pb-5">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
              {description ? (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
