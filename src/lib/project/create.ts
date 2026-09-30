import type { Prisma, PrismaClient } from '@prisma/client';

/** 建项目并存下当时的人设快照(事后改人设不影响已有项目) */
export async function createProject(db: PrismaClient, title?: string) {
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  return db.project.create({
    data: {
      title: title?.trim() || '未命名项目',
      // 经 JSON 往返: 行里的 updatedAt 是 Date, Json 列只收纯 JSON 值
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
    },
  });
}
