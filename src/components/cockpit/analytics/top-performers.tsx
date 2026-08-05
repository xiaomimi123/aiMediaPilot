import Link from 'next/link';
import type { TopPerformer } from '@/lib/dashboard/types';

function formatPlays(playsStr: string): string {
  const n = Number(playsStr);
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return n.toLocaleString();
}

export function TopPerformers({ items }: { items: TopPerformer[] }) {
  return (
    <div className="space-y-2">
        <h3 className="font-semibold text-[var(--ink)]">🏆 Top 表现</h3>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            还没有复盘数据 — 上传 + 粘贴抖音链接看真实播放
          </div>
        ) : (
          <ol className="space-y-2 text-sm">
            {items.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--muted)]">{i + 1}.</span>
                <Link href={`/content/preflight/${p.id}`} className="flex-1 truncate hover:text-[var(--clay)]">
                  {p.videoFilename}
                </Link>
                <span className="font-semibold tabular-nums">{formatPlays(p.plays)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
  );
}
