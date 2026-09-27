import { ScriptSchema, type Script } from '@/lib/script/model';
import { checkDuration, type DurationReport } from '@/lib/script/duration';
import { ROLE_LABEL } from '@/lib/script/model';
import type { TranscriptFile } from '@/lib/recording/transcript';
import { compareWithScript } from '@/lib/recording/compare';

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
  // 工具结果行与任务通知(system + toolResult)都带 ok; 普通 system 报错行为 null
  const ok =
    (m.role === 'tool' || m.role === 'system') && m.toolResult && typeof m.toolResult === 'object'
      ? Boolean((m.toolResult as { ok?: unknown }).ok)
      : null;
  return { id: m.id, role: m.role as MessageView['role'], content: m.content, toolName: m.toolName, ok };
}

export interface JobView {
  id: string;
  kind: string;
  status: string;
  progress: number;
  userMessage: string;
  errorDetail: string | null;
}

export function toJobView(j: { id: string; kind: string; status: string; progress: number; userMessage: string; errorDetail: string | null }): JobView {
  return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, userMessage: j.userMessage, errorDetail: j.errorDetail };
}

export interface RecordingView {
  videoFileId: string;
  videoUrl: string;
  durationSec: number | null;
  transcript: {
    lines: { startSec: number; endSec: number; text: string; adlib: boolean }[];
    /** 没讲到的段落(中文名) */
    skipped: string[];
    proofread: 'done' | 'skipped' | 'failed';
  } | null;
}

export function buildRecordingView(
  projectId: string,
  script: Script | null,
  video: { id: string; meta: unknown } | null,
  transcript: TranscriptFile | null,
): RecordingView | null {
  if (!video) return null;
  const meta = (video.meta ?? {}) as { durationSec?: unknown };
  let view: RecordingView['transcript'] = null;
  if (transcript) {
    const cmp = script ? compareWithScript(script, transcript.lines) : null;
    view = {
      lines: transcript.lines.map((l, i) => ({ ...l, adlib: cmp ? cmp.lines[i].adlib : false })),
      skipped: cmp ? cmp.segments.filter((s) => s.skipped).map((s) => ROLE_LABEL[s.role]) : [],
      proofread: transcript.proofread,
    };
  }
  return {
    videoFileId: video.id,
    videoUrl: `/api/projects/${projectId}/files/${video.id}`,
    durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : null,
    transcript: view,
  };
}
