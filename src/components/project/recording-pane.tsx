'use client';

import { useRef, useState } from 'react';
import type { JobView, ProjectView, RecordingView } from '@/lib/project/view';
import { cn } from '@/lib/utils';
import { Teleprompter } from './teleprompter';
import { uploadVideo } from './upload';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function RecordingPane({
  project,
  recording,
  job,
  onUploaded,
  onRetry,
}: {
  project: ProjectView;
  recording: RecordingView | null;
  job: JobView | null;
  onUploaded: () => void;
  onRetry: (jobId: string) => Promise<void>;
}) {
  const [prompter, setPrompter] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sampleState, setSampleState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const input = useRef<HTMLInputElement>(null);

  if (!project.script) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-secondary)]">先在「脚本」里把稿子写出来，再来录。</div>;
  }
  const running = job && (job.status === 'running' || job.status === 'queued');
  const failed = job && (job.status === 'failed' || job.status === 'interrupted');

  async function send(file: File | undefined) {
    if (!file || uploading !== null) return;
    if (running) {
      // 不能静默忽略: 用户拖了文件却什么都没发生, 会以为坏了
      setUploadError('上一个视频还在转写，等它完成再传。');
      return;
    }
    setUploadError(null);
    setUploading(0);
    const r = await uploadVideo(project.id, file, setUploading);
    setUploading(null);
    if (r.ok) onUploaded();
    else setUploadError(r.message);
  }

  async function addAsSample() {
    if (!recording?.transcript) return;
    setSampleState('saving');
    const j = await fetch('/api/voice-samples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: project.title, text: recording.transcript.lines.map((l) => l.text).join('\n'), source: 'transcript' }),
    })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '没加上，检查网页服务是否在运行' }));
    setSampleState(j.success ? 'saved' : (j.message ?? '没加上'));
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {prompter && <Teleprompter script={project.script} onClose={() => setPrompter(false)} />}

      <div className="mb-4 flex items-center gap-3">
        <button className="btn-primary" onClick={() => setPrompter(true)}>
          打开提词器
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">照着稿子录，录完把视频拖进来</span>
      </div>

      <div
        className={cn(
          'mb-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed p-6 text-sm',
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
          void send(e.dataTransfer.files[0]);
        }}
      >
        {uploading !== null
          ? `上传中… ${Math.round(uploading * 100)}%`
          : recording
            ? '重新录了？把新视频拖到这里替换（旧版本会保留）'
            : '把录好的口播视频拖到这里，或点击选择（mp4 / mov）'}
        <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      </div>
      {uploadError && <p className="mb-4 text-sm text-[var(--danger)]">{uploadError}</p>}

      {running && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--info-subtle)] px-4 py-3 text-sm text-[var(--info)]">
          正在转写… {Math.round(job.progress * 100)}%
        </div>
      )}
      {failed && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--danger-subtle)] px-4 py-3 text-sm">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-[var(--danger)]">{job.userMessage}</p>
            <button
              disabled={retrying}
              className="btn-secondary text-[var(--text-primary)] disabled:opacity-50"
              onClick={async () => {
                // 请求返回前禁用, 防止双击启动两次转写
                if (retrying) return;
                setRetrying(true);
                try {
                  await onRetry(job.id);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              重试
            </button>
          </div>
          {job.errorDetail && (
            <details className="mt-2 text-xs text-[var(--text-tertiary)]">
              <summary>详情</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{job.errorDetail}</pre>
            </details>
          )}
        </div>
      )}

      {recording && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <video src={recording.videoUrl} controls className="max-h-[60vh] w-full rounded-lg bg-black" />
          <div className="min-w-0">
            {recording.transcript ? (
              <>
                {recording.transcript.skipped.length > 0 && (
                  <p className="mb-2 text-sm text-[var(--warning)]">没讲到：{recording.transcript.skipped.join('、')}</p>
                )}
                <div className="mb-2 flex items-center gap-2 text-xs">
                  {sampleState === 'saved' ? (
                    <span className="text-[var(--text-tertiary)]">已加为说话样本</span>
                  ) : (
                    <button className="btn-secondary text-xs" disabled={sampleState === 'saving'} onClick={() => void addAsSample()}>
                      加为说话样本
                    </button>
                  )}
                  {sampleState !== 'idle' && sampleState !== 'saving' && sampleState !== 'saved' && <span className="text-[var(--danger)]">{sampleState}</span>}
                </div>
                {recording.transcript.proofread === 'failed' && (
                  <p className="mb-2 text-xs text-[var(--text-tertiary)]">自动校对没成功，下面是原始识别结果。</p>
                )}
                <ol className="space-y-1 text-sm">
                  {recording.transcript.lines.map((l, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-10 shrink-0 font-mono text-xs text-[var(--text-tertiary)]">{mmss(l.startSec)}</span>
                      <span className="flex-1">{l.text}</span>
                      {l.adlib && <span className="shrink-0 text-xs text-[var(--warning)]">临场加的</span>}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              !running && !failed && <p className="text-sm text-[var(--text-secondary)]">还没有转写结果。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
