'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Mode = 'skeleton' | 'full';
const DURATIONS = [30, 45, 60, 90] as const;

/**
 * 新建稿子。
 *
 * **默认骨架模式**: 完整初稿最容易把人带向 AI 的表达 —— 眼前摆着一段通顺的话,
 * 人会本能地在上面改几个词就交差, 而那段话 AI 也会写给别人。骨架只告诉你每一幕
 * 该干什么, 台词必须自己写。
 *
 * 完整初稿仍然留着: 没思路的时候让 AI 开个头, 比对着空白页干坐着强。但它得是
 * 一个明确的选择, 不是默认。
 */
export function NewScript({ inspirations }: { inspirations: { id: string; text: string }[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<Mode>('skeleton');
  const [durationSec, setDurationSec] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (topic.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/scripts/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(), niche: 'ai-knowledge', platform: 'douyin', durationSec, mode,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.message ?? '生成失败');
        return;
      }
      router.push(`/write/${body.data.scriptDraftId}`);
    } catch {
      setError('生成失败，请检查网络后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mb-5">
        <label className="block">
          <span className="text-xs font-medium">选题</span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="想讲什么？一句话说清楚就行"
            className="mt-1 w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
          />
        </label>

        {inspirations.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">或者从灵感库挑一个：</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {inspirations.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setTopic(i.text)}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    {i.text.length > 28 ? `${i.text.slice(0, 28)}…` : i.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            灵感库是空的。去「拆解」拆一条同赛道创作者的片子，衍生选题会写进那里。
          </p>
        )}
      </section>

      <section className="mb-5">
        <p className="text-xs font-medium">起点给到什么程度</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode('skeleton')}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              mode === 'skeleton' ? 'border-primary bg-secondary' : 'border-border hover:bg-accent',
            )}
          >
            <p className="text-sm font-medium">只给骨架</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              六幕各给一句「这一幕该干什么」+ 时长 + 需要什么材料，
              <span className="font-medium text-foreground">台词全空着等你写</span>。
              最不容易把你带向 AI 的表达。
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('full')}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              mode === 'full' ? 'border-primary bg-secondary' : 'border-border hover:bg-accent',
            )}
          >
            <p className="text-sm font-medium">写完整初稿</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              台词写满，你在上面改。没思路时让 AI 开个头，比对着空白页干坐着强——
              但容易改几个词就交差。
            </p>
          </button>
        </div>
      </section>

      <section className="mb-5">
        <p className="text-xs font-medium">全片时长</p>
        <div className="mt-2 flex gap-1.5">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDurationSec(d)}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                durationSec === d ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent',
              )}
            >
              {d} 秒
            </button>
          ))}
        </div>
      </section>

      <Button disabled={busy || topic.trim().length < 3} onClick={() => void generate()}>
        {busy ? '生成中…' : mode === 'skeleton' ? '搭骨架' : '写初稿'}
      </Button>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </>
  );
}
