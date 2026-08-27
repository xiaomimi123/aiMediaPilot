'use client';

import { useState } from 'react';
import { Tabs } from '@/components/ui/tabs';

interface RadarRow {
  id: string; title: string; url: string; source: string;
  heat: number; angle: string; collectedAt: string;
}
interface InspirationRow { id: string; text: string; createdAt: string; used: number }

/**
 * 选题两个 tab。
 *
 * 雷达按热度排序而不是时间: 102 条按时间排等于让你从最新的一条一路翻下去,
 * 而热度分本来就是为了替你做这个排序的。
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
              待处理 {backlog} 条，已采纳 {adoptedCount} 条。采集速度超过消化速度——
              减关键词或提高热度门槛，比硬着头皮翻完更有用。
            </p>
          ) : null}

          {radar.length === 0 ? (
            <p className="text-sm text-muted-foreground">雷达还没抓到东西。</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {radar.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm hover:underline"
                    >
                      {r.title}
                    </a>
                    {r.angle ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.angle}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.source} · {r.collectedAt}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-secondary px-2 py-0.5 text-xs tabular-nums">
                    {r.heat}
                  </span>
                </li>
              ))}
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
