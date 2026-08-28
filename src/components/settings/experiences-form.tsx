'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EXPERIENCE_KINDS, EXPERIENCE_KIND_LABELS, type ExperienceKind } from '@/lib/persona/voice';
import { cn } from '@/lib/utils';
import { inputCls } from './primitives';

interface Row {
  id: string;
  content: string;
  topic: string;
  kind: string;
  keywords: string[];
  usedCount: number;
  createdAt: string;
}

/**
 * 个人经历。
 *
 * 这是**唯一**被当作「使用者本人真有的材料」喂给写稿的地方。骨架模式的
 * prompt 里明写: 只有这一节列出的东西才是你真有的, 联网研究抓回来的是第三方
 * 信息, 不许写成你的经历 —— 那条规则是真机上骨架把别人的创业故事写成
 * 「你 14 岁卖掉了第一家公司」之后加的。
 *
 * 所以这一页空着的代价是具体的: 空着的时候 AI 只能描述「这里需要一个什么样的
 * 材料」, 填不进任何真东西。
 *
 * 逐条即时保存(不是整份替换): 每条经历是独立的一条记录, 增删改互不影响,
 * 用不着整份档案那套「显式保存」的谨慎。
 */
export function ExperiencesForm({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<ExperienceKind>('practice');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function add() {
    const content = draft.trim();
    if (content.length === 0) return;
    setBusy('add');
    setError('');
    try {
      const res = await fetch('/api/v1/experiences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '添加失败');
        return;
      }
      const created = body.data.experience as Row;
      // 类型是单独一次 PATCH —— POST 只收 content
      if (draftKind) {
        await fetch(`/api/v1/experiences/${created.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: draftKind }),
        });
        created.kind = draftKind;
      }
      setRows([created, ...rows]);
      setDraft('');
    } catch {
      setError('添加失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  async function patch(id: string, data: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));
    await fetch(`/api/v1/experiences/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => setError('保存失败，刷新页面看看改动在不在'));
  }

  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/v1/experiences/${id}`, { method: 'DELETE' });
    setBusy('');
    if (res.ok) setRows((rs) => rs.filter((r) => r.id !== id));
    else setError('删除失败');
  }

  return (
    <>
      <div className="mb-6 rounded-md border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          记一条
        </p>
        <textarea
          value={draft}
          rows={3}
          maxLength={500}
          placeholder="一件具体发生过的事。带上当时的动作、数字和心理——越具体，写稿时越用得上。"
          onChange={(e) => setDraft(e.target.value)}
          className={cn(inputCls, 'mt-2 resize-y')}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {EXPERIENCE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setDraftKind(k)}
              className={cn(
                'rounded-md border px-3 py-1 text-xs transition-colors',
                draftKind === k
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
              )}
            >
              {EXPERIENCE_KIND_LABELS[k]}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-auto"
            disabled={busy === 'add' || draft.trim().length === 0}
            onClick={() => void add()}
          >
            {busy === 'add' ? '添加中…' : '记下'}
          </Button>
        </div>
      </div>

      {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          还没有经历。空着的代价是具体的：写稿时 AI 只能说「这里需要一个什么样的材料」，
          填不进任何真东西——而那些真东西正是同行抄不走的部分。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-card p-3.5">
              <textarea
                value={r.content}
                rows={2}
                maxLength={500}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, content: e.target.value } : x)))}
                onBlur={(e) => void patch(r.id, { content: e.target.value })}
                className={cn(inputCls, 'resize-y border-0 bg-transparent p-0 focus:border-0')}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <select
                  value={r.kind}
                  onChange={(e) => void patch(r.id, { kind: e.target.value })}
                  className="rounded border border-border bg-card px-2 py-0.5 text-xs"
                >
                  <option value="">未分类</option>
                  {EXPERIENCE_KINDS.map((k) => (
                    <option key={k} value={k}>{EXPERIENCE_KIND_LABELS[k]}</option>
                  ))}
                </select>
                <span className="tabular-nums">用过 {r.usedCount} 次</span>
                <span>{r.createdAt.slice(0, 10)}</span>
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => void remove(r.id)}
                  className="ml-auto hover:text-destructive"
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
