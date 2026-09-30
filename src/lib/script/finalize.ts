import type { PrismaClient } from '@prisma/client';
import { ScriptSchema } from './model';
import { proposeSafely } from '@/lib/notes/proposals';

export async function finalizeScript(db: PrismaClient, projectId: string, propose: (projectId: string) => Promise<void> = (id) => proposeSafely(db, id, 'finalize')) {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error('项目不存在或已删除');
  if (!ScriptSchema.safeParse(p.script).success) throw new Error('还没有稿子，不能定稿');
  // 只从写稿中前进; 已定稿/已录制/已出片/已发布的不动(阶段只前进)
  if (p.stage !== 'draft') return p;
  const updated = await db.project.update({ where: { id: projectId }, data: { stage: 'scripted' } });
  // 定稿后提议存进 Obsidian; 失败不影响定稿
  await propose(projectId).catch(() => {});
  return updated;
}
