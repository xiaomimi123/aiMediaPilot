'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABEL } from '@/lib/script/model';

type RepoItem = { id: string; outerId: string; title: string; summary: string | null; url: string; heat: number; day: string };
type Segment = { id: string; role: string; text: string };
type VoiceResult = { file: string; speaker: string; bytes: number } | { error: string };
type DemoResult = { file: string; kind: string } | { error: string };
type NewsResult = { title: string; script: { segments: Segment[] }; questions: string[]; flavor: { kind: string; label: string; text: string }[]; readmeUrl?: string; project?: { id: string }; voice?: VoiceResult; demo?: DemoResult };

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

/** 开源快讯: 近 3 天抓到的 GitHub 热门仓库, 点一个出 30 秒口播稿, 顺手建作品 */
export function OpenSourceNews() {
  const router = useRouter();
  const [repos, setRepos] = useState<RepoItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<NewsResult | null>(null);
  const [resultRepo, setResultRepo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [withVoice, setWithVoice] = useState(true);
  const [withDemo, setWithDemo] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/sources/github').then((r) => r.json()).catch(() => ({ success: false }));
    setRepos(j.success && Array.isArray(j.data) ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const preview = async (item: RepoItem) => {
    if (busyId) return;
    setBusyId(item.outerId);
    setErr(null);
    setResult(null);
    const j = await post('/api/sources/news', { outerId: item.outerId });
    setBusyId(null);
    if (!j.success) return setErr(j.message);
    setResult(j.data);
    setResultRepo(item.outerId);
  };

  const create = async () => {
    if (!result || !resultRepo || creating) return;
    setCreating(true);
    setErr(null);
    const j = await post('/api/sources/news', { outerId: resultRepo, action: 'create', title: result.title, voice: withVoice, demo: withDemo });
    setCreating(false);
    if (!j.success) return setErr(j.message);
    const v = j.data.voice as VoiceResult | null | undefined;
    const d = j.data.demo as DemoResult | null | undefined;
    const problems: string[] = [];
    if (v && 'error' in v) problems.push(`配音没生成：${v.error}`);
    if (d && 'error' in d) problems.push(`演示画面没生成：${d.error}`);
    if (problems.length) {
      // 配音/演示失败不拦建作品: 提示后照常进项目
      setErr(`作品已建好，但${problems.join('；')}`);
      setTimeout(() => router.push(`/projects/${j.data.project.id}`), 3500);
      return;
    }
    router.push(`/projects/${j.data.project.id}`);
  };

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">开源快讯</h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">近 3 天抓到的 GitHub 热门仓库。点「出稿」生成 30 秒快讯口播稿（读 README，不编造），顺眼就建作品；快讯档反响好的再升级成亲测档。</p>
      </div>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {!repos ? (
        <p className="text-sm text-[var(--text-tertiary)]">加载中…</p>
      ) : repos.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">近 3 天还没有 GitHub 仓库入库。每天 19:00 自动抓，或在终端跑 npm run fetch:sources。</p>
      ) : (
        <ul className="space-y-2">
          {repos.map((r) => (
            <li key={r.id} className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <a className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline" href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                <span className="shrink-0 chip text-xs">{`${r.heat.toLocaleString('en-US')} stars`}</span>
                <button className="btn-secondary shrink-0 px-3 py-1 text-xs" disabled={busyId !== null} onClick={() => void preview(r)}>
                  {busyId === r.outerId ? '正在读 README…' : '出稿'}
                </button>
              </div>
              {r.summary && <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{r.summary}</p>}
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="space-y-3 rounded-[var(--r-md)] border border-[var(--accent-border)] bg-[var(--bg-surface)] p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{result.title}</b>
            <span className="text-xs text-[var(--text-tertiary)]">{resultRepo} · 30 秒快讯稿</span>
          </div>
          <div className="space-y-1">
            {result.script.segments.map((s) => (
              <p key={s.id}>
                <span className="mr-1 text-xs text-[var(--text-tertiary)]">{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role}</span>
                <span>{s.text}</span>
              </p>
            ))}
          </div>
          {result.flavor.length > 0 && (
            <div className="rounded-[var(--r-md)] bg-[var(--warning-subtle)] p-2">
              <p className="text-xs text-[var(--warning)]">这几句有 AI 腔，念之前改掉：</p>
              <ul className="list-disc pl-5">
                {result.flavor.map((h, i) => (
                  <li key={i}>
                    「{h.text}」— {h.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={creating} onClick={() => void create()}>
              {creating ? (withVoice || withDemo ? '建作品中（配音/画面在生成）…' : '建作品中…') : '就做这条（建作品）'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={withVoice} onChange={(e) => setWithVoice(e.target.checked)} />
              同时生成 AI 配音（火山 TTS）
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={withDemo} onChange={(e) => setWithDemo(e.target.checked)} />
              同时生成演示画面（官网/介绍页录屏，约 1 分钟）
            </label>
            <button className="btn-secondary" disabled={creating} onClick={() => setResult(null)}>
              收起
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
