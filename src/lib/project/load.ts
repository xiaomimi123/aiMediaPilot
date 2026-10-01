import type { PrismaClient } from '@prisma/client';
import { reconcileInterruptedJobs } from '@/lib/jobs/runner';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { loadReference, type Reference } from '@/lib/benchmark/adopt';
import { toProjectView, toMessageView, toJobView, buildRecordingView, toMaterialView, toFilmView, type ProjectView, type MessageView, type RecordingView, type JobView, type MaterialView, type FilmView } from './view';

export interface ProjectBundle {
  project: ProjectView;
  messages: MessageView[];
  recording: RecordingView | null;
  jobs: JobView[];
  materials: MaterialView[];
  films: FilmView[];
  /** 对标作品(选题一步展示) */
  reference: Reference | null;
  published: boolean;
  hasRetro: boolean;
}

/** 项目页与 GET /api/projects/:id 共用。先把上个进程留下的运行中任务标成已中断。 */
export async function loadProjectBundle(db: PrismaClient, id: string): Promise<ProjectBundle | null> {
  await reconcileInterruptedJobs(db);
  const p = await db.project.findUnique({ where: { id } });
  if (!p) return null;
  const [messages, video, transcript, jobs, materialRows, filmRows, reference, publishedCount, retro] = await Promise.all([
    db.chatMessage.findMany({ where: { projectId: id }, orderBy: { createdAt: 'asc' } }),
    db.projectFile.findFirst({ where: { projectId: id, kind: 'raw_video' }, orderBy: { version: 'desc' } }),
    loadCurrentTranscript(db, id),
    db.job.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    db.projectFile.findMany({ where: { projectId: id, kind: 'material' }, orderBy: { createdAt: 'asc' } }),
    db.projectFile.findMany({ where: { projectId: id, kind: 'final_mp4' }, orderBy: { createdAt: 'desc' } }),
    loadReference(db, p.benchmarkVideoId ?? null),
    db.publishedWork.count({ where: { projectId: id } }),
    db.retro.findUnique({ where: { projectId: id }, select: { id: true } }),
  ]);
  const project = toProjectView(p);
  return {
    project,
    messages: messages.map(toMessageView),
    recording: buildRecordingView(id, project.script, video, transcript?.data ?? null),
    jobs: jobs.map(toJobView),
    materials: materialRows.map((f) => toMaterialView(id, f)),
    films: filmRows.map((f) => toFilmView(id, f, materialRows.map((m) => toMaterialView(id, m)))),
    reference,
    published: publishedCount > 0,
    hasRetro: !!retro,
  };
}
