'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { pct } from '@/lib/works/chart';

interface Row {
  id: string; title: string; url: string; publishedAt: string;
  play: number; digg: number; comment: number; collect: number; counted: boolean;
  scriptDraftId: string | null;
  /** 分析窗口外的作品没有这个值。 */
  completionRate5s: number | null;
}

export interface DraftOption {
  id: string;
  topic: string;
  /** 打得出分才是有效样本; 打不出分的(非六幕/还没写)在选项里标出来。 */
  scorable: boolean;
}

/**
 * 回采作品列表。
 *
 * 「算不算进基线」逐条可改判 —— 这个开关直接决定基线中位数, 不该由一个关键词表
 * 替用户拍板。默认只勾中当前赛道且够新的, 其余摊开让人自己看。
 *
 * 默认只显示计入的: 101 条里 91 条是 0 播放的旧内容, 全列出来会把真正有信息量的
 * 那几条埋掉。
 *
 * **关联稿子**是校准的唯一入口: 平台不会告诉你哪条作品是用哪份稿子发的, 只能由
 * 人来认领。缺了这一步, 校准永远凑不齐「预测分 vs 实际表现」的配对 —— 哪怕你真
 * 发了一条系统写的稿子。
 */
export function WorkList({
  initial,
  yearFrom,
  drafts,
}: {
  initial: Row[];
  yearFrom: number;
  drafts: DraftOption[];
}) {
  const [rows, setRows] = useState(initial);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const shown = showAll ? rows : rows.filter((r) => r.counted);
  const countedNum = rows.filter((r) => r.counted).length;

  async function link(r: Row, scriptDraftId: string | null) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/v1/works/${r.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scriptDraftId }),
      });
      if (res.ok) {
        setRows((p) => p.map((x) => (x.id === r.id ? { ...x, scriptDraftId } : x)));
      }
    } finally {
      setBusy(null);
    }
  }

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
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        用本系统写的稿子发出去的，在右边把稿子认领上——
        <span className="text-foreground">平台不会告诉系统哪条作品对应哪份稿子</span>，
        而校准要的就是这个配对。
      </p>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
        {shown.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 p-3">
            {/* 整行进详情 —— 那里才有两个口径的播放量、完播率、钩子和关联的稿子 */}
            <Link href={`/data/${r.id}`} className="min-w-0 flex-1">
              <p className="text-sm">{r.title || '(无标题)'}</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {r.publishedAt} · {r.play.toLocaleString()} 播 · {r.digg} 赞 · {r.comment} 评 ·{' '}
                {r.collect} 藏
                {r.completionRate5s !== null ? (
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-foreground">
                    完播 {pct(r.completionRate5s)}
                  </span>
                ) : null}
              </p>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              {/* 0 播放的隐藏作品没有可校准的表现, 不给关联入口免得白填 */}
              {r.play > 0 ? (
                <select
                  value={r.scriptDraftId ?? ''}
                  disabled={busy === r.id}
                  onChange={(e) => void link(r, e.target.value || null)}
                  className="max-w-40 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground"
                  title="这条是用哪份稿子发的"
                >
                  <option value="">未关联稿子</option>
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.scorable ? '' : '(无分) '}
                      {d.topic.length > 18 ? `${d.topic.slice(0, 18)}…` : d.topic}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void toggle(r)}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors',
                  r.counted ? 'bg-secondary' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {r.counted ? '计入基线' : '不计入'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
