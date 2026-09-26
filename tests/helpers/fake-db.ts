import type { PrismaClient } from '@prisma/client';

/**
 * 工具层与对话循环测试用的内存假库 —— 只实现被用到的方法。
 * 用真 Prisma 需要起库, 单元测试不该依赖外部服务。
 */
export interface FakeProject {
  id: string;
  title: string;
  stage: string;
  script: unknown;
  targetSec: number;
  personaSnapshot: unknown;
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

export function createFakeDb(seed: { project?: Partial<FakeProject>; persona?: Record<string, unknown> | null } = {}) {
  const project: FakeProject = {
    id: 'p1',
    title: '未命名项目',
    stage: 'draft',
    script: null,
    targetSec: 60,
    personaSnapshot: null,
    updatedAt: new Date(),
    ...seed.project,
  };
  const messages: FakeMessage[] = [];
  let seq = 0;
  const db = {
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
        const m: FakeMessage = {
          id: `m${++seq}`,
          content: '',
          toolName: null,
          toolInput: null,
          toolResult: null,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        messages.push(m);
        return m;
      },
      findMany: async ({ where, take }: { where: { projectId: string }; take?: number }) => {
        const rows = messages.filter((m) => m.projectId === where.projectId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
  };
  return { db: db as unknown as PrismaClient, project, messages };
}
