import Link from 'next/link';
import type { TodoItem } from '@/lib/cockpit/overview';
import { cn } from '@/lib/utils';

/** 今日待办。空的时候如实说空, 不硬凑几条让页面看起来忙。 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">今日待办</h2>
        <span className="text-xs text-muted-foreground">{todos.length} 项</span>
      </div>

      {todos.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">没有挡路的事。去「写稿」继续。</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cn('text-sm', t.tone === 'block' && 'text-destructive')}>{t.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.detail}</p>
              </div>
              {t.href ? (
                <Link href={t.href} className="shrink-0 text-xs underline underline-offset-4">
                  查看
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
