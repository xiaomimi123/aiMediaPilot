'use client';

import { useRef, useState } from 'react';
import type { FilmView, MaterialView } from '@/lib/project/view';
import { cn } from '@/lib/utils';
import { FilmAssistant } from './film-assistant';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function usageText(u: FilmView['usage'][number]): string {
  const clip = u.clipFromSec !== undefined && u.clipToSec !== undefined ? ` ${mmss(u.clipFromSec)}–${mmss(u.clipToSec)}` : '';
  const speed = u.speed && u.speed !== 1 ? ` · ${u.speed} 倍速` : '';
  return `${mmss(u.atSec)} 起 ${u.durSec} 秒 · ${u.materialName}${clip}${speed}`;
}

function uploadMaterial(projectId: string, file: File, note: string, onProgress: (r: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/projects/${projectId}/materials`);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-note', encodeURIComponent(note));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { success?: boolean; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // 非 JSON 响应按失败处理
      }
      resolve(body.success ? null : body.message ?? `上传失败（${xhr.status}）`);
    };
    xhr.onerror = () => resolve('网络断了，上传没完成。重新拖进来再传一次。');
    xhr.send(file);
  });
}

export function FilmPane({ projectId, materials, films, onChanged }: { projectId: string; materials: MaterialView[]; films: FilmView[]; onChanged: () => void }) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // 最近一次保存的说明; 不能拿 props 比(保存后 props 不刷新, 清空说明会被当成"没改"而漏存)
  const savedNotes = useRef(new Map(materials.map((m) => [m.id, m.note])));

  async function send(list: FileList | null) {
    if (!list || list.length === 0 || uploading !== null) return;
    setError(null);
    for (const file of Array.from(list)) {
      setUploading(0);
      const err = await uploadMaterial(projectId, file, '', setUploading);
      if (err) setError(`${file.name}：${err}`);
    }
    setUploading(null);
    onChanged();
  }

  async function saveNote(id: string, note: string) {
    const prev = savedNotes.current.get(id);
    savedNotes.current.set(id, note);
    const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
    const j = await res.json();
    if (!j.success) {
      savedNotes.current.set(id, prev ?? '');
      setError(j.message);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (!j.success) setError(j.message);
    onChanged();
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <FilmAssistant projectId={projectId} onChanged={onChanged} />
      <section>
        <h3 className="mb-2 text-[15px] font-semibold">素材</h3>
        <div
          className={cn(
            'mb-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed p-5 text-sm',
            dragging ? 'border-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          )}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void send(e.dataTransfer.files);
          }}
        >
          {uploading !== null ? `上传中… ${Math.round(uploading * 100)}%` : '把录屏、视频、截图、图片拖到这里，或点击选择'}
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.m4v" className="hidden" onChange={(e) => void send(e.target.files)} />
        </div>
        {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
        <ul className="space-y-2">
          {materials.map((m) => (
            <li key={m.id} className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
              {m.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
              ) : (
                <video src={m.url} preload="metadata" muted className="h-16 w-24 shrink-0 rounded bg-black object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="truncate">{m.originalName}</span>
                  {m.durationSec !== null && <span className="font-mono">{mmss(m.durationSec)}</span>}
                  <div className="flex-1" />
                  <button className="text-[var(--danger)]" onClick={() => void remove(m.id)}>
                    删除
                  </button>
                </div>
                <input
                  className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-sm"
                  placeholder="一句说明（可不写），比如：讲安装那段，用 0:10～0:40"
                  defaultValue={m.note}
                  onBlur={(e) => e.target.value !== (savedNotes.current.get(m.id) ?? m.note) && void saveNote(m.id, e.target.value)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">成片</h3>
        {films.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">还没有成片。在上面「出片助手」里点「出一版」。</p>
        ) : (
          <>
            <ul className="space-y-4">
              {films.map((f) => (
                <li key={f.id} className="card">
                  <div className="mb-2 flex items-center gap-3 text-sm">
                    <b>{`成片 v${f.version}`}</b>
                    {f.orientation === 'landscape' && <span className="chip">横版</span>}
                    <span className="text-xs text-[var(--text-tertiary)]">{new Date(f.createdAt).toLocaleString('zh-CN')}</span>
                    <div className="flex-1" />
                    <a className="text-xs text-[var(--accent)]" href={f.url} download={`成片v${f.version}.mp4`}>
                      下载
                    </a>
                  </div>
                  {f.summary && <p className="mb-2 text-sm text-[var(--text-secondary)]">{f.summary}</p>}
                  <video src={f.url} controls className={cn('mb-2 rounded bg-black', f.orientation === 'landscape' ? 'w-full' : 'max-h-[60vh]')} />
                  {f.usage.length > 0 && (
                    <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                      {f.usage.map((u, i) => (
                        <li key={i} className="font-mono">
                          {usageText(u)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
