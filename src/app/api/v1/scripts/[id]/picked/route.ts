import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import type { PickedState } from '@/lib/script-picked/types';

function parsePicked(input: unknown): PickedState | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const reviewed: Record<string, boolean> = {};
  if (o.reviewed && typeof o.reviewed === 'object') {
    for (const [k, v] of Object.entries(o.reviewed as Record<string, unknown>)) {
      if (typeof v === 'boolean') reviewed[k] = v;
    }
  }
  return {
    titleIdx: typeof o.titleIdx === 'number' && Number.isInteger(o.titleIdx) ? o.titleIdx : undefined,
    hookIdx: typeof o.hookIdx === 'number' && Number.isInteger(o.hookIdx) ? o.hookIdx : undefined,
    reviewed,
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

  const picked = parsePicked(body);
  if (!picked) return fail('picked 数据非法', 400);

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  try {
    await prisma.scriptDraft.update({
      where: { id },
      data: { picked: picked as any },
    });
    return ok({ saved: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT scripts/picked]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
