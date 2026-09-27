'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilmView, JobView, MaterialView, MessageView, ProjectView, RecordingView } from '@/lib/project/view';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';
import { ScriptPane } from './script-pane';
import { RecordingPane } from './recording-pane';
import { ChatPanel } from './chat-panel';
import { FilmPane } from './film-pane';

type Tab = 'script' | 'recording' | 'film';
const TABS: { key: Tab; label: string }[] = [
  { key: 'script', label: '① 脚本' },
  { key: 'recording', label: '② 口播' },
  { key: 'film', label: '③ 成片' },
];
const isActive = (j: JobView | undefined) => !!j && (j.status === 'running' || j.status === 'queued');

export function ProjectWorkspace({
  initialProject,
  initialMessages,
  initialRecording = null,
  initialJobs = [],
  initialMaterials = [],
  initialFilms = [],
}: {
  initialProject: ProjectView;
  initialMessages: MessageView[];
  initialRecording?: RecordingView | null;
  initialJobs?: JobView[];
  initialMaterials?: MaterialView[];
  initialFilms?: FilmView[];
}) {
  const [project, setProject] = useState(initialProject);
  const [recording, setRecording] = useState(initialRecording);
  const [jobs, setJobs] = useState(initialJobs);
  const [materials, setMaterials] = useState(initialMaterials);
  const [films, setFilms] = useState(initialFilms);
  const [notices, setNotices] = useState<MessageView[]>([]);
  const [tab, setTab] = useState<Tab>(initialProject.stage === 'draft' ? 'script' : initialProject.stage === 'final' ? 'film' : 'recording');
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const transcribeJob = jobs.find((j) => j.kind === 'transcribe');
  const wasActive = useRef(isActive(transcribeJob));

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`);
    const j = await res.json();
    if (!j.success) return;
    setProject(j.data.project);
    setRecording(j.data.recording ?? null);
    setJobs(j.data.jobs ?? []);
    setMaterials(j.data.materials ?? []);
    setFilms(j.data.films ?? []);
    setNotices(((j.data.messages ?? []) as MessageView[]).filter((m) => m.role === 'system' && m.toolName?.startsWith('job:')));
  }, [project.id]);

  // 有任务在跑就每 2 秒拉一次; 任务从"运行中"变成结束时切到口播标签
  useEffect(() => {
    const active = isActive(transcribeJob);
    if (wasActive.current && !active) setTab('recording');
    wasActive.current = active;
    if (!active) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [transcribeJob, refresh]);

  const patch = useCallback(
    async (body: object) => {
      setError(null);
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.success) setProject(j.data);
      else setError(j.message);
    },
    [project.id],
  );

  const onTurnEvent = useCallback((e: AgentEvent) => {
    if (e.type === 'tool' && e.ok && e.segmentIds.length) {
      setHighlighted((prev) => new Set([...prev, ...e.segmentIds]));
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-subtle)] px-6 py-3">
        <input
          // 非受控输入只读一次 defaultValue; 以标题做 key, agent 改名后刷新才会跟上
          key={project.title}
          className="w-full bg-transparent text-base font-semibold outline-none"
          defaultValue={project.title}
          onBlur={(e) => e.target.value.trim() !== project.title && void patch({ title: e.target.value })}
        />
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
      {/* 窄窗口(<768px)上下排: 左右排时对话栏 340px 最小宽度会把页面撑出横向滚动 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div role="tablist" className="flex gap-1 border-b border-[var(--border-subtle)] px-6 pt-2 text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={cn(
                  'rounded-t-md px-3 py-1.5',
                  tab === t.key ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'script' && (
              <ScriptPane
                project={project}
                highlighted={highlighted}
                onEdit={async (segmentId, text) => {
                  setHighlighted(new Set());
                  await patch({ edit: { segmentId, text } });
                }}
                onFinalize={() => patch({ finalize: true })}
              />
            )}
            {tab === 'recording' && (
              <RecordingPane
                project={project}
                recording={recording}
                job={transcribeJob ?? null}
                onUploaded={() => void refresh()}
                onRetry={async (jobId) => {
                  const res = await fetch(`/api/projects/${project.id}/jobs/${jobId}/retry`, { method: 'POST' });
                  const j = await res.json();
                  if (!j.success) setError(j.message);
                  await refresh();
                }}
              />
            )}
            {tab === 'film' && <FilmPane projectId={project.id} materials={materials} films={films} onChanged={() => void refresh()} />}
          </div>
        </div>
        <div className="h-[45%] shrink-0 md:h-auto md:w-[36%] md:min-w-[340px]">
          <ChatPanel
            projectId={project.id}
            initialMessages={initialMessages}
            incoming={notices}
            // 发出新消息时清掉上一轮的高亮; 本轮工具改的段落保留到下一轮
            onTurnStart={() => setHighlighted(new Set())}
            onTurnEvent={onTurnEvent}
            onTurnEnd={() => void refresh()}
          />
        </div>
      </div>
    </div>
  );
}
