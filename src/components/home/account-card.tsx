import Link from 'next/link';
import type { AccountSummary } from '@/lib/account/summary';

const n = (v: number) => v.toLocaleString('en-US');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN') : '—');

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 font-mono text-xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

/** 首页账号数据: 只放口径明确的数; 没有的数据如实说明, 不显示 0 */
export function AccountCard({ summary: s }: { summary: AccountSummary }) {
  const alerts = [s.collect, s.scan].filter((c) => c.state !== 'ok');
  return (
    <section className="mb-6">
      {alerts.map((c) => (
        <div key={c.hint} role="alert" className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--warning-subtle)] px-4 py-3 text-sm text-[var(--warning)]">
          {c.hint}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="粉丝" value={s.fans === null ? '还没回采到' : n(s.fans)} sub={s.fansDelta ? `较上次回采 ${s.fansDelta > 0 ? '+' : ''}${s.fansDelta}` : undefined} />
        <Stat label="获赞" value={s.likes === null ? '还没回采到' : n(s.likes)} sub="主页显示" />
        <Stat label="公开作品" value={`${s.publicWorks} 条`} sub={`播放合计 ${n(s.publicPlay)}`} />
        <Stat label="最近公开发布" value={day(s.lastPublishedAt)} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        <span>
          {s.recent90
            ? `近 90 天投稿 ${s.recent90.submissionCount} 条，播放中位数 ${n(s.recent90.medianPlay)}，5 秒完播率 ${(s.recent90.completionRate5s * 100).toFixed(1)}%`
            : s.hasOverview
              ? '近 90 天没有公开投稿，投稿分析暂无数据'
              : '还没回采到投稿分析'}
        </span>
        {s.dataAt && <span> · 数据更新于 {new Date(s.dataAt).toLocaleString('zh-CN')}</span>}
      </p>
      <Link href="/topics" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">
        {s.hits24h > 0 ? `今天对标里有 ${s.hits24h} 条爆款 →` : '今天对标没有新爆款 →'}
      </Link>
    </section>
  );
}
