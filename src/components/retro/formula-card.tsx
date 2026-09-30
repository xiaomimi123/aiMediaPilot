'use client';

import { useCallback, useEffect, useState } from 'react';

type Proposed = { version: number; reason: { label: string; direction: string; samples: number; oldError: number; newError: number } };

export function FormulaCard({ onChanged }: { onChanged: () => void }) {
  const [p, setP] = useState<Proposed | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/predict/formulas').then((r) => r.json()).catch(() => ({ success: false }));
    setP(j.success ? j.data.proposed : null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!p) return null;
  const decide = async (action: 'accept' | 'reject') => {
    const j = await fetch(`/api/predict/formulas/${p.version}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    if (!j.success) setMsg(j.message);
    await load();
    onChanged();
  };
  const x = (e: number) => Math.exp(e).toFixed(1);
  return (
    <div className="rounded-md border border-[var(--accent)] p-3 text-sm">
      <div className="font-medium">预测公式建议</div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {`${p.reason.label}连续${p.reason.direction === 'optimistic' ? '偏乐观' : '偏悲观'}（最近 3 条都偏 20% 以上）。按 ${p.reason.samples} 条已对账的作品回测：平均误差 ${x(p.reason.oldError)} 倍 → ${x(p.reason.newError)} 倍。采纳后以后的预测用新公式，已有预测不变。`}
      </p>
      <div className="mt-2 flex gap-3 text-xs">
        <button className="text-[var(--accent)]" onClick={() => void decide('accept')}>采纳</button>
        <button className="text-[var(--text-tertiary)]" onClick={() => void decide('reject')}>不要</button>
      </div>
      {msg && <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p>}
    </div>
  );
}
