'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ModelView, ModelTestResult } from '@/lib/llm/providers';

type Preset = { key: string; name: string; kind: 'openai' | 'anthropic'; baseUrl: string; keyOptional?: boolean; note?: string };
const GRADE: Record<ModelTestResult['grade'], { text: string; cls: string }> = {
  able_agent: { text: '能当编导', cls: 'text-[var(--success)]' },
  analysis_only: { text: '只能做分析', cls: 'text-[var(--warning)]' },
  unusable: { text: '不可用', cls: 'text-[var(--danger)]' },
};
const input = 'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm';

async function call(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

type Form = { id?: string; name: string; kind: 'openai' | 'anthropic'; baseUrl: string; model: string; apiKey: string; note?: string };

export function ModelsCard() {
  const [models, setModels] = useState<ModelView[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const j = await call('/api/settings/models');
    if (j.success) {
      setModels(j.data.models);
      setPresets(j.data.presets);
    } else setMsg({ ok: false, text: j.message });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, url: string, method: string, body?: unknown, done?: string) => {
    setBusy(key);
    setMsg(null);
    const j = await call(url, method, body);
    setBusy(null);
    setMsg(j.success ? (done ? { ok: true, text: done } : j.data?.message ? { ok: j.data.grade !== 'unusable', text: j.data.message } : null) : { ok: false, text: j.message });
    if (j.success) setForm(null);
    await load();
  };

  const activate = (m: ModelView) => {
    const g = m.lastTest?.grade;
    if (g !== 'able_agent' && !confirm(g ? `这个模型写稿改稿会失败（${GRADE[g].text}），确定切换吗？` : '这个模型还没测试过，编导可能用不了，确定切换吗？')) return;
    void act(`act-${m.id}`, `/api/settings/models/${m.id}/activate`, 'POST', undefined, `已切换到 ${m.name}。`);
  };

  return (
    <section className="card">
      <div className="mb-1 flex items-center">
        <h3 className="text-[15px] font-semibold">模型</h3>
        <div className="flex-1" />
        {!form && (
          <select className="rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-xs" value="" onChange={(e) => {
            const p = presets.find((x) => x.key === e.target.value);
            if (p) setForm({ name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: '', apiKey: '', note: p.note });
          }}>
            <option value="">＋ 添加模型…</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">编导、写稿、拆解、复盘、找选题、发布文案都用"当前使用"的模型。key 只存在本机数据库里。</p>

      {form && (
        <div className="mb-4 space-y-2 rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <input className={input} placeholder="显示名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form['kind'] })}>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Claude 原生</option>
            </select>
            <input className={`${input} md:col-span-2`} placeholder="接口地址" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            <input className={input} placeholder="模型名（如 deepseek-chat）" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className={input} type="password" autoComplete="off" placeholder={form.id ? 'key（留空不改）' : 'key'} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          {form.note && <p className="text-xs text-[var(--text-tertiary)]">{form.note}</p>}
          <p className="text-xs text-[var(--text-tertiary)]">接口地址是预填的，以厂商文档为准。</p>
          <div className="flex gap-2 text-sm">
            <button className="btn-primary" disabled={busy !== null} onClick={() => {
              const body = { name: form.name, kind: form.kind, baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey };
              void act('save', form.id ? `/api/settings/models/${form.id}` : '/api/settings/models', form.id ? 'PATCH' : 'POST', body, '已保存，点「测试」看看能不能用。');
            }}>保存</button>
            <button className="text-[var(--text-tertiary)]" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      {models === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : models.length === 0 ? (
        <p className="text-sm text-[var(--warning)]">还没有可用的模型：用右上角「添加模型」加一个。</p>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id} className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{m.name}</b>
                {m.isActive && <span className="rounded bg-[var(--accent-subtle)] px-1.5 text-xs text-[var(--accent)]">当前使用</span>}
                {m.lastTest ? <span className={`text-xs ${GRADE[m.lastTest.grade].cls}`}>{GRADE[m.lastTest.grade].text}</span> : <span className="text-xs text-[var(--text-tertiary)]">未测试</span>}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{`${m.kind === 'anthropic' ? 'Claude 原生' : 'OpenAI 兼容'} · ${m.model} · key ${m.keyMasked} · ${m.baseUrl}`}</div>
              {m.lastTest && <p className="mt-1 text-xs text-[var(--text-secondary)]">{m.lastTest.message}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => void act(`test-${m.id}`, `/api/settings/models/${m.id}/test`, 'POST')}>{busy === `test-${m.id}` ? '测试中（约 20 秒）…' : '测试'}</button>
                {!m.isActive && <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => activate(m)}>设为当前</button>}
                <button className="text-[var(--text-secondary)]" onClick={() => setForm({ id: m.id, name: m.name, kind: m.kind, baseUrl: m.baseUrl, model: m.model, apiKey: '' })}>编辑</button>
                <button className="text-[var(--danger)]" disabled={busy !== null} onClick={() => {
                  if (confirm(m.isActive ? `${m.name} 是当前使用的模型，删掉后编导会用不了，确定删除吗？` : `确定删除 ${m.name}？`)) void act(`del-${m.id}`, `/api/settings/models/${m.id}`, 'DELETE', undefined, '已删除。');
                }}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
