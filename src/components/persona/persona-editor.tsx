'use client';

import { useState } from 'react';
import type { Persona } from '@/lib/persona/schema';

const input = 'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm';
const area = `${input} min-h-[72px]`;
const TYPE_LABEL: Record<Persona['offerings'][number]['type'], string> = { tool: '工具', service: '服务', course: '课程', other: '其他' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-[var(--text-secondary)]">{label}</div>
      {children}
    </label>
  );
}

export function PersonaEditor({ initial }: { initial: Persona }) {
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => setP((x) => ({ ...x, [k]: v }));
  const setItem = <K extends 'pillars' | 'painPoints' | 'offerings'>(k: K, i: number, patch: Partial<Persona[K][number]>) =>
    setP((x) => ({ ...x, [k]: x[k].map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const remove = (k: 'pillars' | 'painPoints' | 'offerings', i: number) => setP((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }));

  async function save() {
    setMsg(null);
    const res = await fetch('/api/persona', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const j = await res.json();
    setMsg(j.success ? { ok: true, text: '已保存。之后新建的项目会用这份定位。' } : { ok: false, text: j.message });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-[var(--text-tertiary)]">编导每次写稿都会读这份定位。改动只影响之后新建的项目，已有项目保留建项目时的版本。</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="目标受众"><textarea className={area} value={p.audience} onChange={(e) => set('audience', e.target.value)} /></Field>
        <Field label="想吸引的粉丝"><textarea className={area} value={p.targetFans} onChange={(e) => set('targetFans', e.target.value)} /></Field>
        <Field label="差异化角度"><textarea className={area} value={p.angle} onChange={(e) => set('angle', e.target.value)} /></Field>
        <Field label="忌讳（不做什么）"><textarea className={area} value={p.avoid} onChange={(e) => set('avoid', e.target.value)} /></Field>
      </div>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">内容支柱</h3>
        <div className="space-y-2">
          {p.pillars.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <input className={input} placeholder="支柱名称，如：效率革命" value={it.name} onChange={(e) => setItem('pillars', i, { name: e.target.value })} />
              <input className={input} placeholder="说明" value={it.description} onChange={(e) => setItem('pillars', i, { description: e.target.value })} />
              <button className="justify-self-start text-xs text-[var(--danger)]" onClick={() => remove('pillars', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('pillars', [...p.pillars, { name: '', description: '' }])}>＋ 加一个内容支柱</button>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">受众痛点</h3>
        <div className="space-y-2">
          {p.painPoints.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className={input} placeholder="痛点" value={it.pain} onChange={(e) => setItem('painPoints', i, { pain: e.target.value })} />
              <input className={input} placeholder="依据（可不写）" value={it.evidence} onChange={(e) => setItem('painPoints', i, { evidence: e.target.value })} />
              <button className="justify-self-start text-xs text-[var(--danger)]" onClick={() => remove('painPoints', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('painPoints', [...p.painPoints, { pain: '', evidence: '' }])}>＋ 加一个痛点</button>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">产品与服务</h3>
        <div className="space-y-2">
          {p.offerings.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-2 md:grid-cols-[1fr_120px]">
              <input className={input} placeholder="名称" value={it.name} onChange={(e) => setItem('offerings', i, { name: e.target.value })} />
              <select className={input} value={it.type} onChange={(e) => setItem('offerings', i, { type: e.target.value as Persona['offerings'][number]['type'] })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input className={input} placeholder="解决哪个痛点" value={it.targetPain} onChange={(e) => setItem('offerings', i, { targetPain: e.target.value })} />
              <input className={input} placeholder="说明" value={it.description} onChange={(e) => setItem('offerings', i, { description: e.target.value })} />
              <button className="text-left text-xs text-[var(--danger)]" onClick={() => remove('offerings', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('offerings', [...p.offerings, { name: '', type: 'other', targetPain: '', description: '' }])}>＋ 加一个产品</button>
      </section>

      <Field label="定位摘要（Markdown，编导优先读这一段）">
        <textarea className={`${input} min-h-[240px] font-mono text-xs`} value={p.systemSummary} onChange={(e) => set('systemSummary', e.target.value)} />
      </Field>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]" onClick={() => void save()}>保存</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
