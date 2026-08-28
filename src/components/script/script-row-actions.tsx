'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { hasImpact, impactLines, type DeleteImpact } from '@/lib/script/delete-impact';
import { cn } from '@/lib/utils';

/**
 * 稿库每行的归档 / 删除。
 *
 * **删除要两步, 而且第二步要说清楚失去什么。** 稿子不是孤立的: 回采作品可能认领
 * 了它(那是校准配对, 攒够 30 条要几个月)、发布登记挂在它上面会跟着一起删。一个
 * 空白的「确定删除?」等于没问 —— 人点确定时并不知道自己在放弃什么。
 *
 * **归档摆在删除前面。** `archivedAt` 字段一直有、接口一直在, 只是从来没有入口。
 * 大多数「这稿子不要了」其实只是不想在列表里看见它, 归档就够了; 真正需要抹掉的
 * 是少数。把可逆的那个放在前面, 不可逆的那个要多点一次。
 */
export function ScriptRowActions({
  id,
  topic,
  archived,
  impact,
}: {
  id: string;
  topic: string;
  archived: boolean;
  impact: DeleteImpact;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function archive(next: boolean) {
    setBusy('archive');
    setError('');
    try {
      const res = await fetch(`/api/v1/scripts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: next }),
      });
      if (!res.ok) {
        setError('归档失败');
        return;
      }
      router.refresh();
    } catch {
      setError('归档失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    setBusy('delete');
    setError('');
    try {
      const res = await fetch(`/api/v1/scripts/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '删除失败');
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError('删除失败，请检查网络');
    } finally {
      setBusy('');
    }
  }

  if (confirming) {
    const lines = impactLines(impact);
    return (
      <div className="rounded-md border-l-2 border-destructive/70 bg-destructive/[0.06] px-3 py-2 text-left">
        <p className="text-xs font-medium text-destructive">删除「{topic}」？这一步不可撤销。</p>
        {hasImpact(impact) ? (
          <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">没有别的东西引用它。</p>
        )}
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() => void remove()}
            className="font-medium text-destructive underline underline-offset-4"
          >
            {busy === 'delete' ? '删除中…' : '确认删除'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-muted-foreground underline underline-offset-4"
          >
            取消
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-3 text-xs">
      <button
        type="button"
        disabled={busy !== ''}
        onClick={() => void archive(!archived)}
        className={cn(
          'underline underline-offset-4',
          archived ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {busy === 'archive' ? '…' : archived ? '取消归档' : '归档'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-muted-foreground/70 hover:text-destructive"
      >
        删除
      </button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}
