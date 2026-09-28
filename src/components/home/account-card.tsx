import type { AccountSummary } from "@/lib/account/summary";

const n = (v: number) => v.toLocaleString("en-US");
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("zh-CN") : "—";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 font-mono text-xl">{value}</div>
      {sub && (
        <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">{sub}</div>
      )}
    </div>
  );
}

/** 首页账号数据: 只放口径明确的数; 没有的数据如实说明, 不显示 0 */
export function AccountCard({ summary: s }: { summary: AccountSummary }) {
  const warn = s.collect.state !== "ok";
  return (
    <section className="mb-6">
      {warn && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--warning-subtle)] px-4 py-3 text-sm text-[var(--warning)]"
        >
          {s.collect.hint}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="粉丝"
          value={s.fans === null ? "还没回采到" : n(s.fans)}
          sub={
            s.fansDelta === null
              ? undefined
              : `较上期 ${s.fansDelta > 0 ? "+" : ""}${s.fansDelta}`
          }
        />
        <Stat
          label="作品"
          value={`${s.works} 条（公开 ${s.publicWorks} 条）`}
        />
        <Stat
          label="作品播放合计"
          value={n(s.totalPlay)}
          sub="作品列表接口口径"
        />
        <Stat label="最近公开发布" value={day(s.lastPublishedAt)} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        <span>
          {s.recent90
            ? `近 90 天投稿 ${s.recent90.submissionCount} 条，播放中位数 ${n(s.recent90.medianPlay)}，5 秒完播率 ${(s.recent90.completionRate5s * 100).toFixed(1)}%`
            : "近 90 天没有公开投稿，投稿分析暂无数据"}
        </span>
        {s.dataAt && (
          <span>
            {" "}
            · 数据更新于 {new Date(s.dataAt).toLocaleString("zh-CN")}
          </span>
        )}
      </p>
    </section>
  );
}
