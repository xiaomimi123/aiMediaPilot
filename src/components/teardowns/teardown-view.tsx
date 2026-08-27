'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Segment { summary: string; role: string; technique: string }
interface Result {
  formula?: string;
  segments?: Segment[];
  hooks?: string[];
  takeaways?: string[];
  topicIdeas?: string[];
}
interface Row {
  id: string; title: string; author: string; url: string;
  status: string; result: Record<string, unknown> | null;
  errorMessage: string | null; createdAt: string;
}

/**
 * 拆解。
 *
 * 输入是**口播转写稿**而不是视频文件: 用户实际就是先有转写稿再手工拆的。
 * 视频上传 → ASR 那条路要新起一条管线, 页面上如实标注还没接 —— 摆一个点了没反应
 * 的上传框比没有这个功能更糟。
 */
export function TeardownView({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

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
      <div className="mb-5 rounded-lg border border-border p-4">
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
        <textarea
          value={transcript} onChange={(e) => setTranscript(e.target.value)}
          rows={5}
          placeholder="粘贴口播转写稿（至少 50 字）。听写错字没关系，按上下文理解。"
          className="mt-2 w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            视频上传 → 自动转写还没接（要新起一条 ASR 管线）。现在先贴转写稿。
          </p>
          <Button size="sm" disabled={busy || !title.trim() || transcript.length < 50} onClick={() => void run()}>
            {busy ? '拆解中…' : '拆一条'}
          </Button>
        </div>
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
              <li key={r.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.author ? `${r.author} · ` : ''}{r.createdAt}
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
