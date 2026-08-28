'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HOOK_LABELS, scoreHookStructure, type HookHint, type HookPattern } from '@/lib/hooks/model';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Row { id: string; text: string; pattern: string; origin: string; scriptId: string | null }

/**
 * 钩子库。
 *
 * 排序依据是**结构分**而不是「预测留存」—— 设计稿画的是后者, 但发布 0 条时那个
 * 百分比是编的。页面顶部明说这件事: 让人按一个假信号排序, 比不排序有害得多。
 */
export function HookLibrary({ initial, hints }: { initial: Row[]; hints: HookHint[] }) {
  const [rows, setRows] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const scored = rows
    .map((r) => ({ ...r, score: scoreHookStructure(r.text) }))
    .sort((a, b) => b.score.total - a.score.total);

  async function add() {
    if (text.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/hooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      const body = await res.json();
      if (res.ok) { setRows((p) => [body.data.hook, ...p]); setText(''); }
    } finally { setBusy(false); }
  }

  async function importFromScripts() {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/v1/hooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ importFromScripts: true }),
      });
      const body = await res.json();
      setNote(res.ok ? `从稿子里抽了 ${body.data.imported} 条（重复的会跳过）` : '导入失败');
      if (res.ok && body.data.imported > 0) window.location.reload();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/v1/hooks/${id}`, { method: 'DELETE' });
    if (res.ok) setRows((p) => p.filter((r) => r.id !== id));
  }

  return (
    <>
      <p className="mb-4 rounded-md border border-border bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">下面按「结构分」排序，不是按留存率。</span>{' '}
        结构分只算能量的东西：字数、是否第二人称开头、有没有书名、有没有数字或提问。
        <span className="font-medium text-foreground">它预测不了完播</span>——
        真实留存要等发布后回采，当前发布 0 条。等那条链路通了，这里会换成真实数据排序。
      </p>

      <div className="mb-5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="记一个开场钩子"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button size="sm" disabled={busy || text.trim().length < 2} onClick={() => void add()}>
          记一条
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void importFromScripts()}>
          从我的稿子里抽
        </Button>
      </div>
      {note ? <p className="mb-3 text-xs text-muted-foreground">{note}</p> : null}

      {hints.length > 0 ? (
        <div className="mb-5 rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-medium">
            结构统计{' '}
            <span className="text-xs font-normal text-muted-foreground">
              从这 {hints[0].total} 条里数出来的
            </span>
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {hints.map((h) => (
              <li key={h.key} className="flex justify-between gap-4">
                <span>{h.text}</span>
                <span className="tabular-nums text-muted-foreground">
                  {h.matched}/{h.total}
                </span>
              </li>
            ))}
          </ul>
          {hints[0].underpowered ? (
            <p className="mt-2 text-xs text-destructive">
              样本不足 20 条，这些比例说明不了任何规律，只是当前库的构成。
            </p>
          ) : null}
        </div>
      ) : null}

      {scored.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          钩子库是空的。点「从我的稿子里抽」把已经写过的开场收进来。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {scored.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">{r.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {HOOK_LABELS[r.pattern as HookPattern] ?? r.pattern}
                  {r.scriptId ? (
                    <>
                      {' · '}
                      <Link href={`/write/${r.scriptId}`} className="underline underline-offset-4">
                        出自这份稿子
                      </Link>
                    </>
                  ) : null}
                </p>
                {r.score.notes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {r.score.notes.map((n, i) => (
                      <li key={i} className="text-xs text-destructive">· {n}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs tabular-nums',
                    r.score.total === r.score.max ? 'bg-secondary' : 'bg-destructive/10 text-destructive',
                  )}
                  title="结构分，预测不了留存"
                >
                  {r.score.total}/{r.score.max}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
