import type { PrismaClient } from '@prisma/client';
import { ScriptSchema } from './model';

export async function finalizeScript(db: PrismaClient, projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error('项目不存在或已删除');
  if (!ScriptSchema.safeParse(p.script).success) throw new Error('还没有稿子，不能定稿');
  return db.project.update({ where: { id: projectId }, data: { stage: 'scripted' } });
}
