'use client';

import { useCallback, useEffect, useState } from 'react';

interface Sample {
  id: string;
  title: string;
  text: string;
  source: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = { manual: '手动加的', own_script: '自己写的', transcript: '转写' };

export function VoiceSamplesCard() {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 删除在页面里确认(不用 confirm(): 内置浏览器等环境会屏蔽原生弹窗)
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/voice-samples').then((r) => r.json()).catch(() => ({ success: false }));
    setSamples(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    const j = await fetch('/api/voice-samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, text }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '保存失败，检查网页服务是否在运行' }));
    if (!j.success) return setError(j.message ?? '保存失败');
    setAdding(false);
    setTitle('');
    setText('');
    void load();
  }

  async function remove(id: string) {
    setConfirmDel(null);
    await fetch(`/api/voice-samples/${id}`, { method: 'DELETE' }).catch(() => null);
    void load();
  }

  return (
    <section className="card">
      <div className="mb-1 flex items-center">
        <h3 className="text-[15px] font-semibold">说话样本</h3>
        <div className="flex-1" />
        {!adding && (
          <button className="btn-secondary text-xs" onClick={() => setAdding(true)}>
            加一篇
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">你自己写的口播或真实转写。编导写稿时参考最近 3 篇的说话方式，不抄句子。</p>
      {adding && (
        <div className="mb-3 space-y-2">
          <input className="w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="标题（可不填）" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="h-40 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="贴一篇你自己写的口播稿或录好的转写" value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={() => void save()} disabled={!text.trim()}>
              保存
            </button>
            <button className="btn-secondary text-sm" onClick={() => setAdding(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      {samples === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : samples.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">还没有说话样本。加一篇你自己写的口播，编导写出来会更像你。</p>
      ) : (
        <ul className="space-y-2">
          {samples.map((s) => (
            <li key={s.id} className="rounded-[var(--r-md)] border border-[var(--border-subtle)] p-3">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <b>{s.title || '（无标题）'}</b>
                <span className="chip">{SOURCE_LABEL[s.source] ?? s.source}</span>
                <div className="flex-1" />
                <button className="text-xs text-[var(--danger)]" aria-label={`删除样本 ${s.title || '（无标题）'}`} onClick={() => setConfirmDel(s.id)}>
                  删除
                </button>
              </div>
              {confirmDel === s.id && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--r-md)] bg-[var(--danger-subtle)] px-3 py-2 text-sm">
                  <span className="text-[var(--danger)]">删掉这篇样本？</span>
                  <div className="flex-1" />
                  <button className="rounded-[var(--r-md)] bg-[var(--danger)] px-3 py-1 text-xs text-white" onClick={() => void remove(s.id)}>
                    确定删除
                  </button>
                  <button className="btn-secondary text-xs" onClick={() => setConfirmDel(null)}>
                    取消
                  </button>
                </div>
              )}
              <p className="text-xs text-[var(--text-secondary)]">{s.text.length > 60 ? `${s.text.slice(0, 60)}…` : s.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
