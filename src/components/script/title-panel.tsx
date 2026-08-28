'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 标题 / 话题标签(二十三期)。
 *
 * 这是写稿链路里**唯一一处 AI 直接给成品文字**的地方, 值得说清楚为什么:
 * 标题是包装, 不是你的声音。正文交给 AI 润色, 出来的就是 AI 的表达; 标题只是
 * 给算法和滑动中的拇指看的一行字, 谁写的不影响这支片子是谁的。
 *
 * 每次点都拿**当前正文**重出 —— 你改了哪句, 下次出的标题就跟着变。
 */

export interface TitleSuggestion {
  text: string;
  hookType: string;
  grounded: boolean;
  inventedNumbers: string[];
}

export function TitlePanel({
  scriptId,
  initial,
}: {
  scriptId: string;
  initial: { titles: TitleSuggestion[]; tags: string[] } | null;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/scripts/${scriptId}/titles`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '出标题失败'); return; }
      setData({ titles: body.data.titles, tags: body.data.tags });
    } catch {
      setError('出标题失败，请检查网络');
    } finally { setBusy(false); }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* 剪贴板被拒就算了 —— 标题就在眼前, 手选也能复制 */ }
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="leading-relaxed text-muted-foreground">
        标题是<span className="text-foreground">包装</span>，不是你的声音——所以这里 AI 直接给文字。
        每次都按当前正文重出。
      </p>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? '想标题中…' : data ? '重出一组' : '出标题'}
      </Button>

      {error ? <p className="text-destructive">{error}</p> : null}

      {data ? (
        <>
          <ul className="flex flex-col gap-2">
            {data.titles.map((t) => (
              <li key={t.text} className="rounded-md border border-border bg-card p-2">
                <button
                  type="button"
                  onClick={() => void copy(t.text)}
                  className="text-left leading-relaxed hover:text-foreground/70"
                >
                  {t.text}
                </button>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded bg-secondary px-1 py-0.5">{t.hookType}</span>
                  <span className="tabular-nums">{t.text.length} 字</span>
                  {copied === t.text ? <span className="text-foreground">已复制</span> : null}
                </p>
                {/*
                  编造的数字**只标不拦**: 直接扔掉会连带扔掉好标题, 而标题总共三个,
                  扫一眼的成本极低。数字对不上是最该盯的一类 —— 它读起来最像真的,
                  观众点进来发现对不上, 掉的是完播率和信任。
                */}
                {!t.grounded ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-destructive">
                    稿子里没有 {t.inventedNumbers.join('、')} 这个数——核一下再用。
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <section>
            <p className="font-medium">话题标签</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {data.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => void copy(`#${tag}`)}
                  className="rounded bg-secondary px-1.5 py-0.5 text-[11px] hover:bg-secondary/70"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
