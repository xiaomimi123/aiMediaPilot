'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilmView, JobView, MaterialView, MessageView, ProjectView, RecordingView } from '@/lib/project/view';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';
import { ScriptPane } from './script-pane';
import { RecordingPane } from './recording-pane';
import { ChatPanel } from './chat-panel';
import { FilmPane } from './film-pane';
import { PublishPane } from './publish-pane';
import { StepBar } from './step-bar';
import { TopicStep } from './topic-step';
import { ChatDrawer } from './chat-drawer';
import { currentStep, stepsOf, type StepKey } from '@/lib/overview/steps';
import type { Reference } from '@/lib/benchmark/adopt';

const isNotice = (m: MessageView) => m.role === 'system' && (!!m.toolName?.startsWith('job:') || m.toolName === 'note:proposal');
const isActive = (j: JobView | undefined) => !!j && (j.status === 'running' || j.status === 'queued');

export function ProjectWorkspace({
  initialProject,
  initialMessages,
  initialRecording = null,
  initialJobs = [],
  initialMaterials = [],
  initialFilms = [],
  initialReference = null,
  initialPublished = false,
  initialHasRetro = false,
}: {
  initialProject: ProjectView;
  initialMessages: MessageView[];
  initialRecording?: RecordingView | null;
  initialJobs?: JobView[];
  initialMaterials?: MaterialView[];
  initialFilms?: FilmView[];
  initialReference?: Reference | null;
  initialPublished?: boolean;
  initialHasRetro?: boolean;
}) {
  const [project, setProject] = useState(initialProject);
  const [recording, setRecording] = useState(initialRecording);
  const [jobs, setJobs] = useState(initialJobs);
  const [materials, setMaterials] = useState(initialMaterials);
  const [films, setFilms] = useState(initialFilms);
  const [notices, setNotices] = useState<MessageView[]>([]);
  const [reference, setReference] = useState(initialReference);
  const [published, setPublished] = useState(initialPublished);
  const [hasRetro, setHasRetro] = useState(initialHasRetro);
  const steps = stepsOf({ stage: project.stage, hasBenchmark: !!reference, hasScript: !!project.script, published, hasRetro });
  // 默认停在当前步骤
  const [tab, setTab] = useState<StepKey>(() =>
    currentStep({ stage: initialProject.stage, hasBenchmark: !!initialReference, hasScript: !!initialProject.script, published: initialPublished, hasRetro: initialHasRetro }),
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const openChat = (v: boolean) => {
    setChatOpen(v);
    if (v) setUnread(false);
  };
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  // 预测面板「让编导按这个改」: 交给对话框当用户消息发出
  const [pendingSend, setPendingSend] = useState<{ id: string; text: string } | null>(null);
  const [quoted, setQuoted] = useState<string | null>(null);
  // 编导测过 / 定稿后, 让预测面板重新读
  const [predictionKey, setPredictionKey] = useState(0);
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
    if ('reference' in j.data) setReference(j.data.reference ?? null);
    if ('published' in j.data) setPublished(!!j.data.published);
    if ('hasRetro' in j.data) setHasRetro(!!j.data.hasRetro);
    setNotices(((j.data.messages ?? []) as MessageView[]).filter(isNotice));
  }, [project.id]);

  // 新通知(任务完成 / 存笔记卡片 / 预测完成)到来时展开对话一次; 同一条不重复弹
  // 打开页面时已有的通知算看过, 只对之后新来的弹开
  const seenNotices = useRef(new Set(initialMessages.filter(isNotice).map((m) => m.id)));
  useEffect(() => {
    const fresh = notices.filter((n) => !seenNotices.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seenNotices.current.add(n.id));
    setChatOpen(true);
    setUnread(false);
  }, [notices]);

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
    <div className={cn('flex h-full flex-col transition-[padding]', chatOpen && 'lg:pr-[var(--drawer-w)]')}>
      <div className="px-4 pt-4 md:px-8">
        <input
          // 非受控输入只读一次 defaultValue; 以标题做 key, agent 改名后刷新才会跟上
          key={project.title}
          className="mb-3 w-full bg-transparent text-[22px] font-bold outline-none"
          defaultValue={project.title}
          onBlur={(e) => e.target.value.trim() !== project.title && void patch({ title: e.target.value })}
        />
        <StepBar steps={steps} active={tab} onSelect={setTab} />
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
      {/* 底部留出悬浮按钮的位置, 不挡最后一行 */}
      <div className="min-h-0 flex-1 pb-16">
        <div className="mx-auto h-full w-full max-w-[820px]">
          {tab === 'topic' && (
            <div className="h-full overflow-y-auto px-4 py-5 md:px-6">
              <TopicStep reference={reference} />
            </div>
          )}
          {tab === 'script' && (
            <ScriptPane
              project={project}
              highlighted={highlighted}
              onEdit={async (segmentId, text) => {
                setHighlighted(new Set());
                await patch({ edit: { segmentId, text } });
              }}
              onHighlight={(id) => setQuoted(id)}
              quoted={quoted}
              predictionKey={predictionKey}
              onAskEditor={(text) => {
                setPendingSend({ id: String(Date.now()), text });
                openChat(true);
              }}
              onPredictionChanged={() => void refresh()}
              onFinalize={async () => {
                await patch({ finalize: true });
                // 定稿会提议存进 Obsidian: 拉一次对话拿到确认卡片
                await refresh();
                setPredictionKey((k) => k + 1);
              }}
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
          {tab === 'publish' && <PublishPane projectId={project.id} section="publish" onChanged={() => void refresh()} />}
          {tab === 'retro' && <PublishPane projectId={project.id} section="retro" onChanged={() => void refresh()} />}
        </div>
      </div>
      <ChatDrawer open={chatOpen} onOpenChange={openChat} unread={unread}>
        <ChatPanel
          projectId={project.id}
          initialMessages={initialMessages}
          incoming={notices}
          pendingSend={pendingSend}
          // 发出新消息时清掉上一轮的高亮; 本轮工具改的段落保留到下一轮
          onTurnStart={() => {
            setHighlighted(new Set());
            openChat(true);
          }}
          onTurnEvent={onTurnEvent}
          onTurnEnd={() => {
            void refresh();
            setPredictionKey((k) => k + 1);
            setUnread((u) => u || !chatOpenRef.current);
          }}
        />
      </ChatDrawer>
    </div>
  );
}
