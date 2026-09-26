'use client';

import { useCallback, useState } from 'react';
import type { MessageView, ProjectView } from '@/lib/project/view';
import type { AgentEvent } from '@/lib/agent/loop';
import { ScriptPane } from './script-pane';
import { ChatPanel } from './chat-panel';

export function ProjectWorkspace({ initialProject, initialMessages }: { initialProject: ProjectView; initialMessages: MessageView[] }) {
  const [project, setProject] = useState(initialProject);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`);
    const j = await res.json();
    if (j.success) setProject(j.data.project);
  }, [project.id]);

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
        <div className="min-h-0 min-w-0 flex-1">
          <ScriptPane
            project={project}
            highlighted={highlighted}
            onEdit={async (segmentId, text) => {
              setHighlighted(new Set());
              await patch({ edit: { segmentId, text } });
            }}
            onFinalize={() => patch({ finalize: true })}
          />
        </div>
        <div className="h-[45%] shrink-0 md:h-auto md:w-[36%] md:min-w-[340px]">
          <ChatPanel
            projectId={project.id}
            initialMessages={initialMessages}
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
