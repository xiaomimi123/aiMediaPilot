import Link from 'next/link';
import type { OverviewData } from '@/lib/overview/load';
import { StepDots } from '@/components/works/step-dots';
import { NewProjectButton } from '@/components/project/new-project-button';

export function TodayPanel({ data }: { data: OverviewData }) {
  return (
    <section className="card-hero">
      <h2 className="mb-3 text-[15px] font-semibold">今天</h2>
      {data.empty ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
          今天没有要处理的，去写一条？
          <NewProjectButton />
        </div>
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-3 md:overflow-visible">
          {data.todos.length > 0 && (
            <div className="card min-w-[260px] snap-start">
              <div className="t-label mb-2">要你处理</div>
              <ul className="space-y-2 text-sm">
                {data.todos.map((t, i) => (
                  <li key={i}>
                    <Link href={t.href} className={t.kind === 'task' || t.kind === 'lag' ? 'text-[var(--warning)]' : 'hover:text-[var(--accent)]'}>
                      {`${t.text} →`}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.inProgress.slice(0, 3).map((w) => (
            <Link key={w.id} href={`/projects/${w.id}`} className="card min-w-[260px] snap-start">
              <div className="mb-1 flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold">{w.title}</span>
                {w.first && <span className="chip shrink-0 bg-[var(--accent)] text-[var(--text-on-accent)]">先发这条</span>}
              </div>
              <StepDots steps={w.steps} />
              <div className="mt-2 text-xs text-[var(--text-secondary)]">{w.next}</div>
              {w.center !== null && <div className="mt-1 text-xs text-[var(--text-tertiary)]">{`预测 ~${w.center.toLocaleString('en-US')}`}</div>}
            </Link>
          ))}
          <Link href="/topics" className="card min-w-[260px] snap-start">
            <div className="t-label mb-2">今日对标爆款</div>
            {data.hits.length ? (
              <ul className="space-y-1 text-sm">
                {data.hits.map((h, i) => (
                  <li key={i} className="truncate">{`${h.author}（平时 ${h.ratio ?? '?'} 倍）${h.topic}`}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-[var(--text-secondary)]">
                <span className="font-display text-[28px] font-bold text-[var(--text-primary)]">0</span>
                <div>{`关注 ${data.following} 个账号 · 去加对标 →`}</div>
              </div>
            )}
          </Link>
        </div>
      )}
    </section>
  );
}
