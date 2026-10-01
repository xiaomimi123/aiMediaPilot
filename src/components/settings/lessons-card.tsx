'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LessonView } from '@/lib/retro/view';
import { LessonCard } from '@/components/retro/lesson-card';

export function LessonsCard() {
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/lessons').then((r) => r.json()).catch(() => ({ success: false }));
    setLessons(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card">
      <h3 className="mb-1 text-[15px] font-semibold">写法库</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">复盘里编导提的经验，采纳后编导写稿都会遵守（生效的最多 10 条）。</p>
      {lessons === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : lessons.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">还没有写法经验。发布后的复盘里，编导提的经验你采纳后会出现在这里。</p>
      ) : (
        <div className="space-y-2">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </section>
  );
}
