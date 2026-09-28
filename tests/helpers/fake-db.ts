import type { PrismaClient } from '@prisma/client';

/**
 * 工具层、对话循环、任务执行器测试用的内存假库 —— 只实现被用到的方法。
 * 用真 Prisma 需要起库, 单元测试不该依赖外部服务。
 */
export interface FakeProject {
  id: string;
  title: string;
  stage: string;
  script: unknown;
  targetSec: number;
  personaSnapshot: unknown;
  benchmarkVideoId?: string | null;
  updatedAt: Date;
}
export interface FakeMessage {
  id: string;
  projectId: string;
  role: string;
  content: string;
  toolName: string | null;
  toolInput: unknown;
  toolResult: unknown;
  createdAt: Date;
}
export interface FakeJob {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: number;
  userMessage: string;
  errorDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface FakeFile {
  id: string;
  projectId: string;
  kind: string;
  path: string;
  meta: unknown;
  version: number;
  createdAt: Date;
}

type JobWhere = { id?: string; projectId?: string; kind?: string; status?: { in: string[] }; updatedAt?: { lt: Date } };

export function createFakeDb(
  seed: {
    project?: Partial<FakeProject>;
    persona?: Record<string, unknown> | null;
    jobs?: Partial<FakeJob>[];
    files?: Partial<FakeFile>[];
    benchmarkVideo?: { id: string; transcript: string | null; analysis: unknown; ratio: number | null; account: { nickname: string } };
  } = {},
) {
  let seq = 0;
  const now = () => new Date(Date.now() + ++seq);
  const project: FakeProject = {
    id: 'p1',
    title: '未命名项目',
    stage: 'draft',
    script: null,
    targetSec: 60,
    personaSnapshot: null,
    benchmarkVideoId: null,
    updatedAt: new Date(),
    ...seed.project,
  };
  const messages: FakeMessage[] = [];
  const jobs: FakeJob[] = (seed.jobs ?? []).map((j) => ({
    id: `j${++seq}`,
    projectId: 'p1',
    kind: 'transcribe',
    status: 'queued',
    progress: 0,
    userMessage: '',
    errorDetail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...j,
  }));
  const files: FakeFile[] = (seed.files ?? []).map((f) => ({
    id: `f${++seq}`,
    projectId: 'p1',
    kind: 'raw_video',
    path: '/tmp/none',
    meta: {},
    version: 1,
    createdAt: new Date(),
    ...f,
  }));
  const jobMatch = (j: FakeJob, w: JobWhere) =>
    (!w.id || j.id === w.id) &&
    (!w.projectId || j.projectId === w.projectId) &&
    (!w.kind || j.kind === w.kind) &&
    (!w.status || w.status.in.includes(j.status)) &&
    (!w.updatedAt || j.updatedAt < w.updatedAt.lt);

  const db = {
    benchmarkVideo: {
      findUnique: async ({ where }: { where: { id: string } }) => (seed.benchmarkVideo && seed.benchmarkVideo.id === where.id ? { ...seed.benchmarkVideo } : null),
    },
    project: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== project.id) throw new Error('not found');
        return { ...project };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === project.id ? { ...project } : null),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeProject> }) => {
        if (where.id !== project.id) throw new Error('not found');
        Object.assign(project, data, { updatedAt: new Date() });
        return { ...project };
      },
    },
    personaProfile: {
      findUnique: async () => seed.persona ?? null,
    },
    chatMessage: {
      create: async ({ data }: { data: Partial<FakeMessage> & { projectId: string; role: string } }) => {
        const m: FakeMessage = { id: `m${++seq}`, content: '', toolName: null, toolInput: null, toolResult: null, createdAt: now(), ...data };
        messages.push(m);
        return m;
      },
      findMany: async ({ where, take }: { where: { projectId: string }; take?: number }) => {
        const rows = messages.filter((m) => m.projectId === where.projectId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
    job: {
      create: async ({ data }: { data: Partial<FakeJob> & { projectId: string; kind: string } }) => {
        const t = now();
        const j: FakeJob = { id: `j${++seq}`, status: 'queued', progress: 0, userMessage: '', errorDetail: null, createdAt: t, updatedAt: t, ...data };
        jobs.push(j);
        return { ...j };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeJob> }) => {
        const j = jobs.find((x) => x.id === where.id);
        if (!j) throw new Error('not found');
        Object.assign(j, data, { updatedAt: now() });
        return { ...j };
      },
      updateMany: async ({ where, data }: { where: JobWhere; data: Partial<FakeJob> }) => {
        const hit = jobs.filter((j) => jobMatch(j, where));
        for (const j of hit) Object.assign(j, data, { updatedAt: now() });
        return { count: hit.length };
      },
      findFirst: async ({ where }: { where: JobWhere }) =>
        jobs.filter((j) => jobMatch(j, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      findMany: async ({ where, take }: { where: JobWhere; take?: number }) => {
        const rows = jobs.filter((j) => jobMatch(j, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
    projectFile: {
      create: async ({ data }: { data: Partial<FakeFile> & { projectId: string; kind: string; path: string } }) => {
        const f: FakeFile = { id: `f${++seq}`, meta: {}, version: 1, createdAt: now(), ...data };
        files.push(f);
        return { ...f };
      },
      findFirst: async ({ where }: { where: { id?: string; projectId?: string; kind?: string } }) =>
        files
          .filter((f) => (!where.id || f.id === where.id) && (!where.projectId || f.projectId === where.projectId) && (!where.kind || f.kind === where.kind))
          .sort((a, b) => b.version - a.version)[0] ?? null,
      findMany: async ({ where }: { where: { projectId?: string; kind?: string } }) =>
        files
          .filter((f) => (!where.projectId || f.projectId === where.projectId) && (!where.kind || f.kind === where.kind))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((f) => ({ ...f })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeFile> }) => {
        const f = files.find((x) => x.id === where.id);
        if (!f) throw new Error('not found');
        Object.assign(f, data);
        return { ...f };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = files.findIndex((x) => x.id === where.id);
        if (i < 0) throw new Error('not found');
        return files.splice(i, 1)[0];
      },
    },
  };
  return { db: db as unknown as PrismaClient, project, messages, jobs, files };
}
