'use client';

import { useEffect, useState } from 'react';
import type { PredictionsData } from '@/app/api/projects/[id]/predictions/route';
import type { PredictionView } from '@/lib/predict/view';

const VERDICT: Record<string, string> = { hit: '命中', optimistic: '偏乐观', pessimistic: '偏悲观' };
const M: Record<string, string> = { hook2s: '开头 2 秒', hook5s: '前 5 秒', middle: '平均观看', ending: '完播', like: '点赞', favorite: '收藏', share: '分享', subscribe: '吸粉' };

function Line({ title, p, views }: { title: string; p: PredictionView; views: number | null }) {
  const r = p.result;
  const top = r.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
  return (
    <div className="space-y-1">
      <div>{`${title}：${r.center === null ? '暂不预测数字' : `中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${top!.label}（${top!.prob}%）`}`}{views !== null && r.center !== null ? ` · 现在 ${views.toLocaleString('en-US')}` : ''}</div>
      {p.check && (
        <div className="text-xs text-[var(--text-secondary)]">
          {`第 ${p.check.dayN} 天对账：${p.check.viewRatio === null ? '' : `实际是预测的 ${p.check.viewRatio.toFixed(1)} 倍${p.check.bucketHit ? '（落在最可能那档）' : ''}；`}`}
          {Object.entries(p.check.verdicts).map(([k, v]) => `${M[k]} ${VERDICT[v!]}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export function PredictionSummary({ projectId, views }: { projectId: string; views: number | null }) {
  const [d, setD] = useState<PredictionsData | null>(null);
  useEffect(() => {
    void fetch(`/api/projects/${projectId}/predictions`).then((r) => r.json()).then((j) => j.success && setD(j.data)).catch(() => {});
  }, [projectId]);
  if (!d || (!d.final && !d.recorded)) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-medium">流量预测</h3>
      {d.final && <Line title="定稿预测" p={d.final} views={views} />}
      {d.recorded && <Line title="录制后预测" p={d.recorded} views={views} />}
    </section>
  );
}
