import type { Prisma, PrismaClient } from '@prisma/client';
import { ScriptSchema, type Script } from './model';

/** agent 的 patch_script 与界面手改共用这一个函数, 保证两边行为一致。 */
export function applySegmentEdit(script: Script, segmentId: string, text: string): Script {
  if (!script.segments.some((s) => s.id === segmentId)) {
    throw new Error(`没有编号为 ${segmentId} 的段落，可用编号：${script.segments.map((s) => s.id).join('、')}`);
  }
  return { segments: script.segments.map((s) => (s.id === segmentId ? { ...s, text: text.trim() } : s)) };
}

/** 整篇替换稿子(润色后「用润色版」)。只在定稿前: 定稿后的稿子已经拿去录了, 不能悄悄换掉。 */
export async function replaceScript(db: Pick<PrismaClient, 'project' | 'chatMessage'>, projectId: string, script: Script, note: string) {
  const parsed = ScriptSchema.safeParse(script);
  if (!parsed.success) throw new Error('稿子格式不对：要 6 段');
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.stage !== 'draft') throw new Error('已定稿的稿子不能直接替换：先在编导对话里说要改');
  const updated = await db.project.update({ where: { id: projectId }, data: { script: parsed.data as unknown as Prisma.InputJsonValue } });
  await db.chatMessage.create({ data: { projectId, role: 'system', content: note, toolName: 'job:polish', toolResult: { ok: true } } });
  return updated;
}
