import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { DEFAULT_TARGET_SEC } from '@/lib/script/model';
import { expandDraft } from '@/lib/draft/expand';
import { getDraft } from '@/lib/draft/store';

export const dynamic = 'force-dynamic';

/** 让 AI 把草稿往下长成完整口播稿 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { targetSec?: number };
  const targetSec = Number.isInteger(b.targetSec) && b.targetSec! >= 15 && b.targetSec! <= 300 ? b.targetSec! : DEFAULT_TARGET_SEC;
  const draft = await getDraft(prisma, params.id);
  if (!draft) return fail('草稿不存在', 404);
  if (!draft.body.trim()) return fail('草稿是空的，先写几句再扩', 400);
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);
  // 标记扩写中(失败时不留这个状态)
  await prisma.draft.update({ where: { id: params.id }, data: { status: 'expanding' } });
  try {
    const ideaText = draft.ideaId ? (await prisma.topicIdea.findUnique({ where: { id: draft.ideaId } }))?.text ?? null : null;
    const out = await expandDraft({ llm: m.llm, body: draft.body, ideaText, targetSec });
    const d = await prisma.draft.update({ where: { id: params.id }, data: { title: draft.title.trim() || out.title.slice(0, 100), body: out.text, status: 'done' } });
    return ok({ ...draft, title: d.title, body: d.body, status: 'done', questions: out.questions });
  } catch (e) {
    await prisma.draft.update({ where: { id: params.id }, data: { status: 'done' } }).catch(() => null);
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
