import Link from 'next/link';
import type { TodoItem } from '@/lib/cockpit/overview';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** tone → 左侧色点。语义沿用 buildTodos: block=挡住整条链路, warn=影响单条内容, info=提示性。 */
const DOT_CLASS: Record<TodoItem['tone'], string> = {
  block: 'bg-bad',
  warn: 'bg-warn',
  info: 'bg-info',
};

/**
 * 按待办的内容判断按钮文案 —— 纯展示层的措辞映射, 不改 buildTodos 的判断逻辑,
 * 也不新增数据字段, 命中不了就兜底成「去处理」。
 */
function actionLabel(t: TodoItem): string {
  if (t.text.includes('worker')) return '去启动';
  if (t.text.includes('超时')) return '去修';
  if (t.text.includes('雷达')) return '去调';
  return '去处理';
}

/** 今日待办。空的时候如实说空, 不硬凑几条让页面看起来忙。 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <section className="rounded-lg border border-line-subtle bg-surface">
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3.5">
        <h2 className="flex-1 text-sm font-semibold text-fg">今日待办</h2>
        {todos.length > 0 ? (
          <span className="badge-base bg-warn-subtle text-warn">{todos.length} 项</span>
        ) : null}
      </div>

      {todos.length === 0 ? (
        <p className="px-4 py-3.5 text-xs leading-relaxed text-fg-3">
          没有挡路的事。去「写稿」继续。
        </p>
      ) : (
        <ul>
          {todos.map((t, i) => (
            <li key={i} className="flex items-center gap-3 border-t border-line-subtle px-4 py-3 first:border-t-0">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{t.text}</p>
                <p className="mt-0.5 text-xs text-fg-3">{t.detail}</p>
              </div>
              {t.href ? (
                <Link href={t.href} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}>
                  {actionLabel(t)}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
