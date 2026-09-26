import { ScriptSchema, type Script } from '@/lib/script/model';
import { checkDuration, type DurationReport } from '@/lib/script/duration';

export interface ProjectView {
  id: string;
  title: string;
  stage: string;
  targetSec: number;
  script: Script | null;
  report: DurationReport | null;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName: string | null;
  ok: boolean | null;
}

export function toProjectView(p: { id: string; title: string; stage: string; targetSec: number; script: unknown; updatedAt: Date }): ProjectView {
  const parsed = ScriptSchema.safeParse(p.script);
  const script = parsed.success ? parsed.data : null;
  return {
    id: p.id,
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script,
    report: script ? checkDuration(script, p.targetSec) : null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toMessageView(m: { id: string; role: string; content: string; toolName: string | null; toolResult: unknown }): MessageView {
  const ok = m.role === 'tool' && m.toolResult && typeof m.toolResult === 'object' ? Boolean((m.toolResult as { ok?: unknown }).ok) : null;
  return { id: m.id, role: m.role as MessageView['role'], content: m.content, toolName: m.toolName, ok };
}
