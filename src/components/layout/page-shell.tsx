import { cn } from '@/lib/utils';

/**
 * 页面外壳(三十四期 UI 重做, 对照设计稿 .topbar + .body)。
 *
 * 结构从「居中窄栏 + 大刊头」换成「置顶横条 + 全宽正文」: 设计稿是高密度工具
 * 界面, 标题与一句话说明并排放进 58px 的 topbar, 正文拿回整幅宽度 ——
 * 表格、双栏、时间线这些密集内容在 max-w-5xl 里都要挤着换行。
 *
 * **有 PageShell 的是页面, 没有的是区块** —— 这条硬规则(5.4)不变:
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
    <main className={cn('flex min-w-0 flex-1 flex-col overflow-y-auto', className)}>
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line-subtle bg-canvas px-6 py-[13px]">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          {/* 标题必须可截断: 内容卡标题可能是整段灵感原文, shrink-0 会把右侧
              操作按钮直接顶出屏(成片详情页实测)。悬停 title 属性看全文。 */}
          <h1 className="min-w-0 shrink truncate text-sm font-semibold text-fg" title={title}>{title}</h1>
          {description ? (
            <p className="truncate text-xs text-fg-3">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="flex flex-col gap-4 px-6 pb-8 pt-[18px]">{children}</div>
    </main>
  );
}
