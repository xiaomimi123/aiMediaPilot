import { fmtViews } from '@/lib/predict/formula';

const Num = ({ v }: { v: string }) => <div className="font-display text-[28px] font-bold leading-tight">{v}</div>;

export function MetricCards({ m }: { m: { fans: number | null; fansDelta: number | null; likes: number | null; works: number; views: number; calib: { count: number; avgError: number | null } } }) {
  const n = (x: number | null) => (x === null ? '—' : x.toLocaleString('en-US'));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <div className="card">
        <div className="t-label">粉丝</div>
        <Num v={n(m.fans)} />
        {m.fansDelta ? <div className={`text-xs ${m.fansDelta > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{`较昨天 ${m.fansDelta > 0 ? '+' : ''}${m.fansDelta}`}</div> : null}
      </div>
      <div className="card">
        <div className="t-label">获赞</div>
        <Num v={n(m.likes)} />
      </div>
      <div className="card">
        <div className="t-label">公开作品 · 播放合计</div>
        <Num v={m.works ? `${m.works} · ${fmtViews(m.views)}` : '—'} />
      </div>
      <div className="card">
        <div className="t-label">预测准度</div>
        <Num v={m.calib.avgError === null ? '—' : `${m.calib.avgError} 倍`} />
        <div className="text-xs text-[var(--text-tertiary)]">{m.calib.count ? `对过 ${m.calib.count} 次账 · 平均偏差 ${m.calib.avgError} 倍` : '还没对过账'}</div>
      </div>
    </div>
  );
}
