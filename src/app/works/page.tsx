import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { loadWorkCards } from '@/lib/overview/load';
import { filterOf, STAGE_FILTERS } from '@/lib/overview/steps';
import { WorkCard } from '@/components/works/work-card';
import { NewProjectButton } from '@/components/project/new-project-button';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function WorksPage({ searchParams }: { searchParams?: { stage?: string; sort?: string } }) {
  const stage = STAGE_FILTERS.some((f) => f.key === searchParams?.stage) ? searchParams!.stage! : 'all';
  const sort = searchParams?.sort === 'predict' ? 'predict' : 'updated';
  const all = await loadWorkCards(prisma);
  let cards = stage === 'all' ? all : all.filter((c) => filterOf(c) === stage);
  if (sort === 'predict') cards = [...cards].sort((a, b) => (b.center ?? -1) - (a.center ?? -1));
  const q = (s: string, so = sort) => `/works?${new URLSearchParams({ ...(s !== 'all' ? { stage: s } : {}), ...(so !== 'updated' ? { sort: so } : {}) })}`;
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold">作品</h1>
        <div className="flex-1" />
        <Link href={q(stage, sort === 'predict' ? 'updated' : 'predict')} className="text-sm text-[var(--accent)]">
          {sort === 'predict' ? '按更新时间' : '按预测排序'}
        </Link>
        <NewProjectButton />
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {STAGE_FILTERS.map((f) => (
          <Link key={f.key} href={q(f.key)} className={cn('chip shrink-0', f.key === stage && 'bg-[var(--accent)] text-[var(--text-on-accent)]')}>
            {`${f.label} ${f.key === 'all' ? all.length : all.filter((c) => filterOf(c) === f.key).length}`}
          </Link>
        ))}
      </div>
      {cards.length === 0 ? (
        <div className="card text-sm text-[var(--text-secondary)]">{all.length === 0 ? '还没有作品。新建一个，和编导聊聊这条讲什么。' : '这个阶段没有作品。'}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-4">
          {cards.map((c) => (
            <WorkCard key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}
