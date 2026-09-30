'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { LessonView } from '@/lib/retro/view';
import { LessonCard } from './lesson-card';

type Item = { projectId: string; title: string; publishedAt: string; retroDayN: number | null; verdicts: Record<string, string> };
const V: Record<string, string> = { good: '好', even: '平', bad: '差', na: '—' };

export function RetroView() {
  const [data, setData] = useState<{ published: Item[]; pendingLinks: { projectId: string; title: string }[] } | null>(null);
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/retro').then((r) => r.json()), fetch('/api/lessons').then((r) => r.json())]);
    setData(a.success ? a.data : { published: [], pendingLinks: [] });
    setLessons(b.success ? b.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || !lessons) return <p className="text-sm text-[var(--text-secondary)]">读取中…</p>;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="min-w-0 space-y-3">
        <h2 className="text-sm font-medium">已发布</h2>
        {data.pendingLinks.map((p) => (
          <Link key={p.projectId} href={`/projects/${p.projectId}`} className="block rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--warning)]">
            {`「${p.title}」有一条作品等你确认是不是它发的 →`}
          </Link>
        ))}
        {data.published.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">还没有关联发布作品的项目。成片发出去后，在项目的「④ 发布与复盘」里关联。</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
            {data.published.map((p) => (
              <li key={p.projectId}>
                <Link href={`/projects/${p.projectId}`} className="block px-3 py-2 text-sm hover:bg-[var(--bg-surface-hover)]">
                  <div className="truncate">{p.title}</div>
                  <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                    {`${new Date(p.publishedAt).toLocaleDateString('zh-CN')} · ${p.retroDayN ? `第 ${p.retroDayN} 天复盘` : Date.now() - new Date(p.publishedAt).getTime() >= 3 * 86400_000 ? '等数据出来再复盘' : '等第 3 天复盘'} · 开头2秒 ${V[p.verdicts.hook2s]} · 前5秒 ${V[p.verdicts.hook5s]} · 完播 ${V[p.verdicts.ending]} · 点赞 ${V[p.verdicts.like]}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="min-w-0 space-y-3">
        <h2 className="text-sm font-medium">写法库（生效的最多 10 条进编导）</h2>
        {lessons.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">还没有写法经验。复盘里编导提的经验，你采纳后会出现在这里。</p> : lessons.map((l) => <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />)}
      </section>
    </div>
  );
}
