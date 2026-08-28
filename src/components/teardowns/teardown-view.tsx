'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Segment { summary: string; role: string; technique: string }
interface PersonaMove { move: string; evidence: string; effect: string }
interface Result {
  formula?: string;
  segments?: Segment[];
  hooks?: string[];
  takeaways?: string[];
  topicIdeas?: string[];
  personaMoves?: PersonaMove[];
  personaSummary?: string;
}
interface Row {
  id: string; title: string; author: string; url: string;
  status: string; result: Record<string, unknown> | null;
  errorMessage: string | null; createdAt: string;
}

/**
 * 拆解。
 *
 * 两条入口:
 *
 * - **贴转写稿** —— 同步跑完, 几秒钟。这条不牵扯 worker, 所以 worker 没在跑也能用。
 * - **传视频** —— 走队列: 本地 Whisper 约 1x 实时, 三分钟的片子要跑三分钟, 撑不住
 *   一个 HTTP 请求。ASR 一直都有(真人出镜模式在用), 之前只是没接到这里。
 *
 * 传视频那条**发起前先读 health**: worker 不在时禁用并说明原因, 而不是让人传完
 * 500MB 然后任务静静躺在队列里 —— 这个项目已经因为那种沉默吃过大亏。
 */
export function TeardownView({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'paste' | 'upload'>('paste');
  const [health, setHealth] = useState<{ ready: boolean; hint: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/v1/health').then((r) => r.json()).then((b) => setHealth(b?.data ?? null)).catch(() => {});
  }, []);

  // 有任务在转写/分析时才轮询 —— 拆完的列表不会自己变
  const pending = rows.some((r) => r.status === 'transcribing' || r.status === 'analyzing');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/teardowns');
        const body = await res.json();
        if (body?.success) {
          setRows(body.data.teardowns.map((t: Row) => ({ ...t, createdAt: String(t.createdAt).slice(0, 10) })));
        }
      } catch { /* 下一轮再说 */ }
    }, 5000);
    return () => clearInterval(t);
  }, [pending]);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('title', title.trim());
      form.append('author', author.trim());
      const res = await fetch('/api/v1/teardowns/upload', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '上传失败'); return; }
      setTitle(''); setAuthor('');
      // 立刻拉一次列表, 让「转写中」那条马上出现并启动轮询
      const list = await fetch('/api/v1/teardowns').then((r) => r.json());
      if (list?.success) {
        setRows(list.data.teardowns.map((t: Row) => ({ ...t, createdAt: String(t.createdAt).slice(0, 10) })));
      }
    } catch {
      setError('上传失败，请检查网络');
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/teardowns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), author: author.trim(), url: '', transcript }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.message ?? '拆解失败'); return; }
      setRows((p) => [{ ...body.data.teardown, createdAt: String(body.data.teardown.createdAt).slice(0, 10) }, ...p]);
      setTitle(''); setAuthor(''); setTranscript('');
    } finally { setBusy(false); }
  }

  async function adopt(id: string) {
    const res = await fetch(`/api/v1/teardowns/${id}/adopt`, { method: 'POST' });
    const body = await res.json();
    setNote(res.ok
      ? `收进库：钩子 ${body.data.hooks} 条、选题 ${body.data.topics} 条`
      : (body?.message ?? '采纳失败'));
  }

  return (
    <>
      <div className="mb-5 rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex gap-1.5">
          {([['paste', '贴转写稿'], ['upload', '传视频']] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                tab === k
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（必填）"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <input
            value={author} onChange={(e) => setAuthor(e.target.value)}
            placeholder="作者"
            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        {tab === 'paste' ? (
          <>
            <textarea
              value={transcript} onChange={(e) => setTranscript(e.target.value)}
              rows={5}
              placeholder="粘贴口播转写稿（至少 50 字）。听写错字没关系，按上下文理解。"
              className="mt-2 w-full resize-y rounded-md border border-input bg-card p-3 text-sm leading-relaxed focus:border-foreground/40 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">几秒钟就拆完，不用等 worker。</p>
              <Button size="sm" disabled={busy || !title.trim() || transcript.length < 50} onClick={() => void run()}>
                {busy ? '拆解中…' : '拆一条'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {health && !health.ready
                  ? health.hint
                  : '本地转写，约 1 倍实时——三分钟的片子要跑三分钟。500MB 以内。'}
              </p>
              <Button
                size="sm"
                disabled={busy || !title.trim() || health?.ready === false}
                title={health?.ready === false ? (health.hint ?? '') : undefined}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? '上传中…' : '选视频'}
              </Button>
            </div>
          </>
        )}
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      {note ? <p className="mb-3 text-xs text-muted-foreground">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有拆解。你在 Obsidian 里手工拆过的那两份，贴进来就能变成可检索的钩子和选题。
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => {
            const res = (r.result ?? {}) as Result;
            return (
              <li key={r.id} className="rounded-md border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-serif-cn text-base font-semibold">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.author ? `${r.author} · ` : ''}{r.createdAt}
                      {/* 在跑的状态要说清楚在跑什么, 「转写中」和「分析中」等待时长差一个数量级 */}
                      {r.status === 'transcribing' ? (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
                          转写中 · 约 1 倍片长
                        </span>
                      ) : r.status === 'analyzing' ? (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
                          拆解中
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {r.status === 'done' ? (
                    <Button size="sm" variant="outline" onClick={() => void adopt(r.id)}>
                      收进钩子库和灵感库
                    </Button>
                  ) : null}
                </div>

                {r.status === 'failed' ? (
                  <p className="mt-2 text-xs text-destructive">
                    拆解失败：{r.errorMessage}（转写稿已保留）
                  </p>
                ) : null}

                {res.formula ? (
                  <p className="mt-3 rounded bg-secondary px-3 py-2 text-xs leading-relaxed">
                    <span className="font-medium">结构公式：</span>{res.formula}
                  </p>
                ) : null}

                {res.personaSummary ? (
                  <div className="mt-3 rounded-md border border-border bg-secondary/40 p-3">
                    <p className="text-xs font-medium">人设：{res.personaSummary}</p>
                    {res.personaMoves?.length ? (
                      <ul className="mt-2 flex flex-col gap-2">
                        {res.personaMoves.map((m, i) => (
                          <li key={i} className="text-xs leading-relaxed">
                            <span className="mr-2 rounded bg-background px-1.5 py-0.5 font-medium">
                              {m.move}
                            </span>
                            <span className="text-muted-foreground">{m.effect}</span>
                            <p className="mt-0.5 text-muted-foreground">「{m.evidence}」</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {res.segments?.length ? (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {res.segments.map((s, i) => (
                      <li key={i} className="text-xs leading-relaxed">
                        <span className="mr-2 rounded bg-secondary px-1.5 py-0.5">{s.role}</span>
                        {s.summary}
                        <span className="text-muted-foreground"> —— {s.technique}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {res.takeaways?.length ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium">可照做的</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {res.takeaways.map((t, i) => (
                        <li key={i} className="text-xs leading-relaxed text-muted-foreground">· {t}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
