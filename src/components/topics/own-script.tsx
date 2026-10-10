'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_TARGET_SEC, type Script } from '@/lib/script/model';
import { splitOriginal, type PolishResult } from '@/lib/script/polish';
import { PolishPanel } from '@/components/project/polish-panel';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

/** 「我自己写了一篇」: 贴自己写的口播 → 润色 → 用润色版或原文建作品(原文存为说话样本) */
export function OwnScript() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [targetSec, setTargetSec] = useState(DEFAULT_TARGET_SEC);
  const [result, setResult] = useState<PolishResult | null>(null);
  const [busy, setBusy] = useState<'polish' | 'create' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const polish = async () => {
    setBusy('polish');
    setErr(null);
    const j = await post('/api/scripts/polish', { text, targetSec });
    setBusy(null);
    if (!j.success) return setErr(j.message);
    setResult(j.data);
  };

  const create = async (script: Script, fallbackTitle?: string) => {
    setBusy('create');
    setErr(null);
    const j = await post('/api/projects', { title: title.trim() || fallbackTitle || '', script, targetSec, voiceSampleText: text });
    if (!j.success) {
      setBusy(null);
      return setErr(j.message);
    }
    // 跑一次稿子预测(后台任务, 不等它)
    void post(`/api/projects/${j.data.id}/predictions`, { kind: 'draft' });
    router.push(`/projects/${j.data.id}`);
  };

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        我自己写了一篇
      </button>
    );
  }
  return (
    <section className="card space-y-3">
      <div className="flex items-center">
        <h2 className="text-[15px] font-semibold">我自己写了一篇</h2>
        <div className="flex-1" />
        <button className="text-xs text-[var(--text-tertiary)]" onClick={() => setOpen(false)}>
          收起
        </button>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">润色只删重复和啰嗦、调顺序、改错字，不加新内容；原文会存为说话样本。</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <input className="w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="标题（可不填）" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="h-64 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="贴上你写的口播稿" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            目标时长
            <input type="number" min={15} max={300} className="w-20 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1" value={targetSec} onChange={(e) => setTargetSec(Number(e.target.value) || DEFAULT_TARGET_SEC)} />
            秒
          </label>
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!text.trim() || busy !== null} onClick={() => void polish()}>
              {busy === 'polish' ? '正在润色…' : '润色'}
            </button>
            <button className="btn-secondary" disabled={!text.trim() || busy !== null} onClick={() => void create(splitOriginal(text))}>
              用原文建作品
            </button>
          </div>
        </div>
        {result && <PolishPanel result={result} useLabel="用润色版建作品" keepLabel="用原文建作品" busy={busy !== null} onUse={() => void create(result.script, result.title)} onKeep={() => void create(splitOriginal(text))} />}
      </div>
    </section>
  );
}
