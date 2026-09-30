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
  /** 工具的原始输出(可展开查看) */
  detail?: string | null;
  /** 存进 Obsidian 的提议(对话里渲染成确认卡片) */
  proposalId?: string | null;
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
  const pid = m.toolResult && typeof m.toolResult === 'object' ? (m.toolResult as { proposalId?: unknown }).proposalId : undefined;
  const text = m.toolResult && typeof m.toolResult === 'object' ? (m.toolResult as { data?: { text?: unknown } | null }).data?.text : undefined;
  return { id: m.id, role: m.role as MessageView['role'], content: m.content, toolName: m.toolName, ok, detail: typeof text === 'string' ? text : null, proposalId: typeof pid === 'string' ? pid : null };
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

export interface MaterialView {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  note: string;
  originalName: string;
  durationSec: number | null;
}

export function toMaterialView(projectId: string, f: { id: string; path: string; meta: unknown }): MaterialView {
  const m = (f.meta ?? {}) as { note?: unknown; originalName?: unknown; mediaType?: unknown; durationSec?: unknown };
  return {
    id: f.id,
    url: `/api/projects/${projectId}/files/${f.id}`,
    mediaType: m.mediaType === 'video' ? 'video' : 'image',
    note: typeof m.note === 'string' ? m.note : '',
    originalName: typeof m.originalName === 'string' ? m.originalName : f.path.split('/').pop() ?? '',
    durationSec: typeof m.durationSec === 'number' ? m.durationSec : null,
  };
}

export interface FilmView {
  id: string;
  version: number;
  url: string;
  createdAt: string;
  summary: string;
  usage: { materialName: string; atSec: number; durSec: number; clipFromSec?: number; clipToSec?: number; speed?: number }[];
}

type UsageRow = { materialId: string; atSec: number; durSec: number; clipFromSec?: number; clipToSec?: number; speed?: number };

export function toFilmView(projectId: string, f: { id: string; path: string; createdAt: Date; meta: unknown }, materials: MaterialView[]): FilmView {
  const m = (f.meta ?? {}) as { filmVersion?: unknown; summary?: unknown; usage?: unknown };
  const usage = (Array.isArray(m.usage) ? (m.usage as UsageRow[]) : []).map(({ materialId, ...rest }) => ({
    materialName: materials.find((x) => x.id === materialId)?.originalName ?? '（已删除的素材）',
    ...rest,
  }));
  return {
    id: f.id,
    version: Number(m.filmVersion) || 0,
    url: `/api/projects/${projectId}/files/${f.id}`,
    createdAt: f.createdAt.toISOString(),
    summary: typeof m.summary === 'string' ? m.summary : '',
    usage,
  };
}
