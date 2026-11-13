'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_TARGET_SEC, type Script } from '@/lib/script/model';
import { splitOriginal, type PolishResult } from '@/lib/script/polish';
import { PolishPanel } from '@/components/project/polish-panel';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

type Draft = {
  id: string;
  title: string;
  body: string;
  source: string;
  ideaId: string | null;
  status: string;
  updatedAt: string;
};

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
};

/** 草稿编辑卡片: 自动保存(停手 800ms 存一次), AI 扩写, 润色建作品 */
function DraftEditor({ draft, onClose, onChanged }: { draft: Draft; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [targetSec, setTargetSec] = useState(DEFAULT_TARGET_SEC);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [expandBusy, setExpandBusy] = useState(false);
  const [expandErr, setExpandErr] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [flavor, setFlavor] = useState<{ kind: string; label: string; text: string }[]>([]);
  const [polishResult, setPolishResult] = useState<PolishResult | null>(null);
  const [busy, setBusy] = useState<'polish' | 'create' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const scheduleSave = useCallback(
    (t: string, b: string) => {
      dirty.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState('saving');
        const j = await fetch(`/api/drafts/${draft.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t, body: b }) })
          .then((r) => r.json())
          .catch(() => ({ success: false }));
        setSaveState(j.success ? 'saved' : 'idle');
        dirty.current = false;
      }, 800);
    },
    [draft.id],
  );

  useEffect(() => {
    const t = saveTimer.current;
    return () => {
      if (t) clearTimeout(t);
    };
  }, []);

  const expand = async () => {
    if (expandBusy) return;
    // 先把没存的内容落盘再扩
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    await fetch(`/api/drafts/${draft.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, body }) }).catch(() => null);
    setSaveState('saved');
    setExpandBusy(true);
    setExpandErr(null);
    setQuestions([]);
    setFlavor([]);
    const j = await post(`/api/drafts/${draft.id}/expand`, { targetSec });
    setExpandBusy(false);
    if (!j.success) {
      setExpandErr(j.message);
      return;
    }
    setBody(j.data.body);
    if (!title.trim()) setTitle(j.data.title);
    setQuestions(Array.isArray(j.data.questions) ? j.data.questions : []);
    setFlavor(Array.isArray(j.data.flavor) ? j.data.flavor : []);
    onChanged();
  };

  const polish = async () => {
    setBusy('polish');
    setErr(null);
    const j = await post('/api/scripts/polish', { text: body, targetSec });
    setBusy(null);
    if (!j.success) return setErr(j.message);
    setPolishResult(j.data);
  };

  const create = async (script: Script, fallbackTitle?: string) => {
    setBusy('create');
    setErr(null);
    const j = await post('/api/projects', { title: title.trim() || fallbackTitle || '', script, targetSec, voiceSampleText: body });
    if (!j.success) {
      setBusy(null);
      return setErr(j.message);
    }
    void post(`/api/projects/${j.data.id}/predictions`, { kind: 'draft' });
    router.push(`/projects/${j.data.id}`);
  };

  return (
    <section className="card space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm font-semibold"
          placeholder="标题（可不填）"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave(e.target.value, body);
          }}
        />
        <span className="shrink-0 text-xs text-[var(--text-tertiary)]" aria-live="polite">
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : ''}
        </span>
        <button className="shrink-0 text-xs text-[var(--text-tertiary)]" onClick={onClose}>
          收起
        </button>
      </div>
      <textarea
        className="h-64 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-3 py-2 text-sm"
        placeholder="想到哪写到哪，停手会自动保存"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          scheduleSave(title, e.target.value);
        }}
      />
      {expandErr && <p className="text-sm text-[var(--danger)]">{expandErr}</p>}
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {flavor.length > 0 && (
        <div className="rounded-[var(--r-md)] bg-[var(--warning-subtle)] p-3">
          <p className="mb-1 text-xs font-medium text-[var(--warning)]">扩写稿里还有 AI 腔，念之前顺手改掉：</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {flavor.map((h, i) => (
              <li key={i}>
                「{h.text}」— {h.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {questions.length > 0 && (
        <div className="rounded-[var(--r-md)] bg-[var(--accent-subtle)] p-3">
          <p className="mb-1 text-xs font-medium">补上这些，稿子会更好：</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={expandBusy || busy !== null || !body.trim()} onClick={() => void expand()}>
          {expandBusy ? 'AI 正在往下长…' : '让 AI 帮我写完'}
        </button>
        <button className="btn-secondary" disabled={busy !== null || expandBusy || !body.trim()} onClick={() => void polish()}>
          {busy === 'polish' ? '正在润色…' : '润色'}
        </button>
        <button className="btn-secondary" disabled={busy !== null || expandBusy || !body.trim()} onClick={() => void create(splitOriginal(body))}>
          用原文建作品
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          目标时长
          <input type="number" min={15} max={300} className="w-20 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1" value={targetSec} onChange={(e) => setTargetSec(Number(e.target.value) || DEFAULT_TARGET_SEC)} />
          秒
        </label>
      </div>
      {polishResult && (
        <PolishPanel
          result={polishResult}
          useLabel="用润色版建作品"
          keepLabel="用原文建作品"
          busy={busy !== null}
          onUse={() => void create(polishResult.script, polishResult.title)}
          onKeep={() => void create(splitOriginal(body))}
        />
      )}
    </section>
  );
}

/** 写稿台: 顶部速记, 下面草稿箱。有灵感 3 秒记一条, 想写了点开接着写。 */
export function DraftDesk({ initialOpen = null }: { initialOpen?: string | null }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [quick, setQuick] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/drafts').then((r) => r.json()).catch(() => ({ success: false }));
    setDrafts(j.success && Array.isArray(j.data) ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const quickSave = async () => {
    const text = quick.trim();
    if (!text || quickBusy) return;
    setQuickBusy(true);
    setErr(null);
    const j = await post('/api/drafts', { body: text });
    setQuickBusy(false);
    if (!j.success) return setErr(j.message);
    setQuick('');
    await load();
  };

  const fromIdea = async () => {
    if (quickBusy) return;
    setQuickBusy(true);
    setErr(null);
    const j = await post('/api/topics/ideas', { text: quick.trim() });
    if (!j.success) {
      setQuickBusy(false);
      return setErr(j.message);
    }
    const d = await post('/api/drafts', { ideaId: j.data.id });
    setQuickBusy(false);
    if (!d.success) return setErr(d.message);
    setQuick('');
    await load();
    setOpenId(d.data.id);
  };

  const remove = async (id: string) => {
    await fetch(`/api/drafts/${id}`, { method: 'DELETE' }).catch(() => null);
    if (openId === id) setOpenId(null);
    await load();
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="text-[15px] font-semibold">灵感速记</h2>
        <p className="text-xs text-[var(--text-secondary)]">有想法 3 秒记下来。现在就写，点「写成草稿」；先攒着，点「存进点子池」（晚间生成选题也会吃它）。</p>
        <textarea
          className="h-20 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-3 py-2 text-sm"
          placeholder="一个想法、一段开头、一个选题……想到什么写什么"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!quick.trim() || quickBusy} onClick={() => void quickSave()}>
            写成草稿
          </button>
          <button className="btn-secondary" disabled={!quick.trim() || quickBusy} onClick={() => void fromIdea()}>
            存进点子池
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">草稿箱</h2>
        {!drafts ? (
          <p className="text-sm text-[var(--text-tertiary)]">加载中…</p>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">还没有草稿。上面记一条灵感，或直接点「写成草稿」开写。</p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) =>
              openId === d.id ? (
                <li key={d.id}>
                  <DraftEditor draft={d} onClose={() => setOpenId(null)} onChanged={() => void load()} />
                </li>
              ) : (
                <li key={d.id} className="card flex items-center gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpenId(d.id)}>
                    <p className="truncate text-sm font-medium">{d.title || d.body.split('\n')[0].slice(0, 40) || '未命名草稿'}</p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">{`${d.body.slice(0, 60)}${d.body.length > 60 ? '…' : ''} · ${timeAgo(d.updatedAt)}`}</p>
                  </button>
                  <button className="shrink-0 text-xs text-[var(--danger)]" aria-label={`删除草稿：${d.title || d.body.slice(0, 10)}`} onClick={() => void remove(d.id)}>
                    删除
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
