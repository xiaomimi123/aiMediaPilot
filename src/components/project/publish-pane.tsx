'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublishKit } from '@/lib/retro/publish-kit';
import type { Diagnosis } from '@/lib/retro/diagnose';
import type { LessonView } from '@/lib/retro/view';
import { DiagnosisView } from '@/components/retro/diagnosis-view';
import { LessonCard } from '@/components/retro/lesson-card';

interface State {
  kit: PublishKit | null;
  work: { id: string; text: string; publishedAt: string; viewCount: number; likeCount: number } | null;
  candidate: { workId: string; text: string; publishedAt: string } | null;
  retro: { dayN: number; diagnosis: Diagnosis; narrative: string | null; narrativeError: string | null; dataAsOf: string | null; updatedAt: string } | null;
  lessons: LessonView[];
}

async function call(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="shrink-0 text-xs text-[var(--accent)]"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  );
}

export function PublishPane({ projectId }: { projectId: string }) {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const base = `/api/projects/${projectId}/publish`;
  const load = useCallback(async () => {
    const j = await call(base);
    if (j.success) setS(j.data);
    else setMsg(j.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setMsg(null);
    const j = await call(url, 'POST', body);
    setBusy(null);
    if (!j.success) setMsg(j.message);
    await load();
  };

  if (!s) return <div className="p-6 text-sm text-[var(--text-secondary)]">{msg ?? '读取中…'}</div>;
  return (
    <div className="h-full space-y-6 overflow-y-auto p-6 text-sm">
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="font-medium">发布文案</h3>
          <button className="text-xs text-[var(--accent)]" disabled={busy !== null} onClick={() => void run('kit', `${base}/kit`)}>
            {busy === 'kit' ? '生成中…' : s.kit ? '重新生成' : '生成发布文案'}
          </button>
        </div>
        {s.kit ? (
          <div className="space-y-2">
            {s.kit.titles.map((t) => (
              <div key={t} className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
                <span className="min-w-0 flex-1">{t}</span>
                <Copy text={t} />
              </div>
            ))}
            <div className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
              <span className="min-w-0 flex-1">{s.kit.hashtags.join(' ')}</span>
              <Copy text={s.kit.hashtags.join(' ')} />
            </div>
            <div className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
              <span className="min-w-0 flex-1">封面字：{s.kit.coverText.join(' / ')}</span>
              <Copy text={s.kit.coverText.join('\n')} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">生成 3 个候选标题、话题标签和封面字，你挑一个在抖音里手动发。</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-medium">发布的作品</h3>
        {s.work ? (
          <p className="text-[var(--text-secondary)]">{`${s.work.text} · ${new Date(s.work.publishedAt).toLocaleDateString('zh-CN')} · 播放 ${s.work.viewCount} · 点赞 ${s.work.likeCount}`}</p>
        ) : (
          <>
            {s.candidate && (
              <div className="mb-3 rounded-md border border-[var(--border-subtle)] p-3">
                <p>这条是你发的吗？</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{`${s.candidate.text.slice(0, 60)} · ${new Date(s.candidate.publishedAt).toLocaleString('zh-CN')}`}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => void run('link', `${base}/link`, { workId: s.candidate!.workId })}>确认</button>
                  <button className="text-[var(--text-tertiary)]" disabled={busy !== null} onClick={() => void run('dismiss', `${base}/dismiss`, { workId: s.candidate!.workId })}>不是</button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5" placeholder="发完后粘贴作品分享链接关联" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3" disabled={!link.trim() || busy !== null} onClick={() => void run('link', `${base}/link`, { text: link })}>关联</button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">发布后第二天回采时，会自动在这里提示候选作品。</p>
          </>
        )}
      </section>

      {s.work && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h3 className="font-medium">复盘</h3>
            {s.retro && <span className="text-xs text-[var(--text-tertiary)]">{`发布第 ${s.retro.dayN} 天${s.retro.dataAsOf ? ` · 数据截至 ${new Date(s.retro.dataAsOf).toLocaleDateString('zh-CN')}` : ''}`}</span>}
            <button className="text-xs text-[var(--accent)]" disabled={busy !== null} onClick={() => void run('retro', `${base}/retro`)}>
              {busy === 'retro' ? '复盘中…' : '现在复盘'}
            </button>
          </div>
          {s.retro ? (
            <div className="space-y-4">
              <DiagnosisView diagnosis={s.retro.diagnosis} />
              <div className="rounded-md bg-[var(--bg-inset)] p-3">
                <div className="mb-1 text-xs text-[var(--text-tertiary)]">编导解读</div>
                {s.retro.narrative ? <p className="whitespace-pre-wrap">{s.retro.narrative}</p> : <p className="text-[var(--danger)]">{s.retro.narrativeError}</p>}
              </div>
              {s.lessons.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-[var(--text-tertiary)]">写法经验（采纳后编导以后写稿都会遵守）</div>
                  {s.lessons.map((l) => (
                    <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-tertiary)]">
              {(() => {
                const days = Math.floor((Date.now() - new Date(s.work.publishedAt).getTime()) / 86400_000);
                return days >= 3
                  ? `已发布 ${days} 天，抖音的数据还没出来，今晚回采后会再试。也可以点「现在复盘」。`
                  : '发布后第 3 天会自动复盘，第 7 天再更新一次；也可以现在手动复盘。';
              })()}
            </p>
          )}
        </section>
      )}
      {msg && <p className="text-xs text-[var(--danger)]">{msg}</p>}
    </div>
  );
}
