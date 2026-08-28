'use client';

import { useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface RadarRow {
  id: string;
  /** 源文章标题。可能是英文 —— 它是出处, 不是选题。 */
  title: string;
  url: string;
  source: string;
  heat: number;
  /** AI 生成的中文选题角度 —— **这才是能直接拿去做视频的东西**。 */
  angle: string;
  summary: string;
  collectedAt: string;
}
interface InspirationRow { id: string; text: string; createdAt: string; used: number }

/**
 * 选题两个 tab。
 *
 * **中文角度是主角, 英文源标题是配角**。第一版把源标题放在主位, 结果一屏里
 * 四分之一是英文新闻标题 —— 那是出处不是选题, 你不会照着 "AI Model Captures How
 * Humans Read" 去拍一条视频, 但会照着「AI 终于读懂你怎么读东西」去拍。
 *
 * 热度分不做主排序: 103 条里 57 条都是 100 分, 按它排和随机排没区别。改成按采集
 * 时间倒序(新的在前), 热度只作为一个标记显示。这不是热度算法的问题该在这里修,
 * 而是**一个区分不了东西的信号不该拿来做排序**。
 */
export function TopicTabs({
  radar, radarTotal, adoptedCount, inspirations,
}: {
  radar: RadarRow[];
  radarTotal: number;
  adoptedCount: number;
  inspirations: InspirationRow[];
}) {
  const [tab, setTab] = useState<'radar' | 'inspiration'>('radar');
  const [expanded, setExpanded] = useState<string | null>(null);
  const backlog = radarTotal - adoptedCount;

  return (
    <>
      <Tabs
        className="mb-4 max-w-xs"
        tabs={[
          { value: 'radar' as const, label: `热点雷达 ${radarTotal}` },
          { value: 'inspiration' as const, label: `灵感库 ${inspirations.length}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'radar' ? (
        <>
          {backlog > 50 ? (
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              待处理 {backlog} 条。采集速度超过消化速度——减关键词或提高门槛，比硬着头皮翻完更有用。
              下面显示的是 AI 为每条新闻拟的<span className="font-medium text-foreground">中文选题角度</span>，
              点开能看到原文出处。
            </p>
          ) : null}

          {radar.length === 0 ? (
            <p className="text-sm text-muted-foreground">雷达还没抓到东西。</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {radar.map((r) => {
                const open = expanded === r.id;
                return (
                  <li key={r.id} className="p-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : r.id)}
                      className="block w-full text-left"
                    >
                      <p className="text-sm leading-relaxed">{r.angle || r.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{r.source}</span>
                        <span>·</span>
                        <span>{r.collectedAt}</span>
                        {r.heat >= 100 ? null : (
                          <>
                            <span>·</span>
                            <span className="tabular-nums">热度 {r.heat}</span>
                          </>
                        )}
                        <span className={cn('ml-auto', open && 'rotate-180')}>⌄</span>
                      </p>
                    </button>

                    {open ? (
                      <div className="mt-2 border-l-2 border-border pl-3">
                        {r.summary ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">{r.summary}</p>
                        ) : null}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          原文：
                          <a href={r.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            {r.title}
                          </a>
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : inspirations.length === 0 ? (
        <p className="text-sm text-muted-foreground">灵感库是空的。看到什么想法随手记一条。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {inspirations.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-4 p-3">
              <p className="min-w-0 text-sm leading-relaxed">{i.text}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {i.used > 0 ? `已用 ${i.used} 次` : i.createdAt}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
