import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import type { PublishChecklistState } from '@/lib/checklist/types';

function parseChecklist(input: unknown): PublishChecklistState | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const arr = Array.isArray(o.actionItemsAdopted) ? o.actionItemsAdopted : [];
  return {
    reviewedHook: Boolean(o.reviewedHook),
    reviewedRetention: Boolean(o.reviewedRetention),
    reviewedTitleCaption: Boolean(o.reviewedTitleCaption),
    reviewedCover: Boolean(o.reviewedCover),
    finalTitle: typeof o.finalTitle === 'string' ? o.finalTitle : '',
    finalCoverNote: typeof o.finalCoverNote === 'string' ? o.finalCoverNote : '',
    actionItemsAdopted: arr.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)),
    rewrittenHook: typeof o.rewrittenHook === 'string' ? o.rewrittenHook : undefined,
    completedAt: typeof o.completedAt === 'string' ? o.completedAt : undefined,
  };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const checklist = parseChecklist(body);
  if (!checklist) return fail('checklist 数据非法', 400);

  const user = await getOrCreateDefaultUser();
  const analysis = await prisma.contentAnalysis.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!analysis || analysis.userId !== user.id) return fail('分析不存在', 404);

  try {
    await prisma.contentAnalysis.update({
      where: { id },
      data: { publishChecklist: checklist as any },
    });
    return ok({ saved: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT checklist]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
