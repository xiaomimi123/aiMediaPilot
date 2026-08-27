import Link from 'next/link';

/**
 * 还没建的板块的统一空态。
 *
 * 「不给未验证的链路做界面」指的是不做**操作入口**, 不是把问题藏起来。这个组件
 * 存在的意义就是把「为什么这里是空的、它在等什么」说清楚 —— 一个查无此页的
 * 侧栏项比一个诚实的空页面糟糕得多。
 */
export function NotBuiltYet({
  what,
  why,
  waitingFor,
  children,
}: {
  what: string;
  why: string;
  waitingFor?: { text: string; href: string };
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dashed border-border p-6">
      <p className="text-sm font-medium">{what}</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{why}</p>
      {children}
      {waitingFor ? (
        <Link href={waitingFor.href} className="mt-3 inline-block text-xs underline underline-offset-4">
          {waitingFor.text} →
        </Link>
      ) : null}
    </section>
  );
}
