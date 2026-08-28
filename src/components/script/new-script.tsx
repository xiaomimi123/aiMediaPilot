'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 三种起点。
 *
 * `import` 是二十三期加的: 在这之前你手上有稿子却进不来 —— 评分、改写度、出片
 * 全用不上, 因为系统只认自己生成的六幕结构。
 *
 * 它和另外两种的关系值得写清楚: 骨架和初稿是**系统给起点**, 导入是**你已经有
 * 起点了**。导入时 AI 只做切分, 一个字都不改 —— 让 AI「完善」你的稿子, 出来的
 * 就是 AI 的表达了, 那正是这套工具一直在避免的事。
 */
type Mode = 'skeleton' | 'full' | 'import';
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
  const [myText, setMyText] = useState('');
  const [durationSec, setDurationSec] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (topic.trim().length < 3) return;
    if (mode === 'import' && myText.trim().length < 50) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        mode === 'import' ? '/api/v1/scripts/import' : '/api/v1/scripts/generate',
        {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'import'
            ? { topic: topic.trim(), text: myText.trim(), durationSec }
            : { topic: topic.trim(), niche: 'ai-knowledge', platform: 'douyin', durationSec, mode },
        ),
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
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">选题</span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="想讲什么？一句话说清楚就行"
            className="mt-1.5 w-full resize-y rounded-md border border-input bg-card p-3.5 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none"
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
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
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
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">起点给到什么程度</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode('skeleton')}
            className={cn(
              'rounded-md border p-4 text-left transition-colors',
              // 选中 = 墨黑边 + 米色底。纸上做记号就是这样做的。
              mode === 'skeleton'
                ? 'border-foreground/70 bg-secondary/70'
                : 'border-border bg-card hover:border-foreground/25',
            )}
          >
            <p className="font-serif-cn text-base font-semibold">只给骨架</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              六幕各给一句「这一幕该干什么」+ 时长 + 需要什么材料，
              <span className="font-medium text-foreground">台词全空着等你写</span>。
              最不容易把你带向 AI 的表达。
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('import')}
            className={cn(
              'rounded-md border p-4 text-left transition-colors',
              mode === 'import'
                ? 'border-foreground/70 bg-secondary/70'
                : 'border-border bg-card hover:border-foreground/25',
            )}
          >
            <p className="font-serif-cn text-base font-semibold">我自己写好了</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              贴进来，AI 只把它切进六幕，
              <span className="font-medium text-foreground">一个字都不改</span>。
              切完就能打分、看时长、出片。
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('full')}
            className={cn(
              'rounded-md border p-4 text-left transition-colors',
              mode === 'full'
                ? 'border-foreground/70 bg-secondary/70'
                : 'border-border bg-card hover:border-foreground/25',
            )}
          >
            <p className="font-serif-cn text-base font-semibold">写完整初稿</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              台词写满，你在上面改。没思路时让 AI 开个头，比对着空白页干坐着强——
              但容易改几个词就交差。
            </p>
          </button>
        </div>
      </section>

      {mode === 'import' ? (
        <section className="mb-5">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              你的稿子
            </span>
            <textarea
              value={myText}
              onChange={(e) => setMyText(e.target.value)}
              rows={10}
              maxLength={8000}
              placeholder="把你写好的口播稿贴进来。至少 50 字。"
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-card p-3.5 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none"
            />
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {myText.trim().length} 字 ·
            切完会<span className="text-foreground">逐字核对</span>，AI 动了你一个字就整个拒绝导入——
            悄悄存一份被改过的稿子，比报错严重得多。
          </p>
        </section>
      ) : null}

      <section className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">全片时长</p>
        <div className="mt-2 flex gap-1.5">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDurationSec(d)}
              className={cn(
                'rounded-md border px-3.5 py-1.5 text-xs tabular-nums transition-colors',
                durationSec === d
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {d} 秒
            </button>
          ))}
        </div>
      </section>

      <Button
        disabled={busy || topic.trim().length < 3 || (mode === 'import' && myText.trim().length < 50)}
        onClick={() => void generate()}
      >
        {busy
          ? mode === 'import' ? '切分中…' : '生成中…'
          : mode === 'import' ? '切进六幕' : mode === 'skeleton' ? '搭骨架' : '写初稿'}
      </Button>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </>
  );
}
