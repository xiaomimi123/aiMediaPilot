import type { PrismaClient } from '@prisma/client';
import { reconcileInterruptedJobs } from '@/lib/jobs/runner';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { toProjectView, toMessageView, toJobView, buildRecordingView, type ProjectView, type MessageView, type RecordingView, type JobView } from './view';

export interface ProjectBundle {
  project: ProjectView;
  messages: MessageView[];
  recording: RecordingView | null;
  jobs: JobView[];
}

/** 项目页与 GET /api/projects/:id 共用。先把上个进程留下的运行中任务标成已中断。 */
export async function loadProjectBundle(db: PrismaClient, id: string): Promise<ProjectBundle | null> {
  await reconcileInterruptedJobs(db);
  const p = await db.project.findUnique({ where: { id } });
  if (!p) return null;
  const [messages, video, transcript, jobs] = await Promise.all([
    db.chatMessage.findMany({ where: { projectId: id }, orderBy: { createdAt: 'asc' } }),
    db.projectFile.findFirst({ where: { projectId: id, kind: 'raw_video' }, orderBy: { version: 'desc' } }),
    loadCurrentTranscript(db, id),
    db.job.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  const project = toProjectView(p);
  return {
    project,
    messages: messages.map(toMessageView),
    recording: buildRecordingView(id, project.script, video, transcript?.data ?? null),
    jobs: jobs.map(toJobView),
  };
}
