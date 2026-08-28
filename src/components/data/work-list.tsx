'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface Row {
  id: string; title: string; url: string; publishedAt: string;
  play: number; digg: number; comment: number; collect: number; counted: boolean;
}

/**
 * 回采作品列表。
 *
 * 「算不算进基线」逐条可改判 —— 这个开关直接决定基线中位数, 不该由一个关键词表
 * 替用户拍板。默认只勾中当前赛道且够新的, 其余摊开让人自己看。
 *
 * 默认只显示计入的: 101 条里 91 条是 0 播放的旧内容, 全列出来会把真正有信息量的
 * 那几条埋掉。
 */
export function WorkList({ initial, yearFrom }: { initial: Row[]; yearFrom: number }) {
  const [rows, setRows] = useState(initial);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const shown = showAll ? rows : rows.filter((r) => r.counted);
  const countedNum = rows.filter((r) => r.counted).length;

  async function toggle(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/v1/works/${r.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ counted: !r.counted }),
      });
      if (res.ok) {
        setRows((p) => p.map((x) => (x.id === r.id ? { ...x, counted: !x.counted } : x)));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">
          回采作品{' '}
          <span className="text-xs font-normal text-muted-foreground">
            计入 {countedNum} / 共 {rows.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs underline underline-offset-4"
        >
          {showAll ? '只看计入的' : `看全部 ${rows.length} 条`}
        </button>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        默认只计入 {yearFrom} 年起、且标题看起来是当前赛道的作品。
        这个开关直接决定基线中位数——判错了自己改，不要让一个关键词表替你拍板。
      </p>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
        {shown.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
                  {r.title || '(无标题)'}
                </a>
              ) : (
                <p className="text-sm">{r.title || '(无标题)'}</p>
              )}
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {r.publishedAt} · {r.play.toLocaleString()} 播 · {r.digg} 赞 · {r.comment} 评 ·{' '}
                {r.collect} 藏
              </p>
            </div>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => void toggle(r)}
              className={cn(
                'shrink-0 rounded px-2 py-1 text-xs transition-colors',
                r.counted ? 'bg-secondary' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {r.counted ? '计入基线' : '不计入'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
