import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { DEFAULT_TARGET_SEC } from '@/lib/script/model';
import { polishScript } from '@/lib/script/polish';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string; targetSec?: number };
  const text = String(b.text ?? '');
  if (!text.trim()) return fail('稿子是空的', 400);
  const targetSec = Number.isInteger(b.targetSec) && b.targetSec! >= 15 && b.targetSec! <= 300 ? b.targetSec! : DEFAULT_TARGET_SEC;
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);
  try {
    return ok(await polishScript({ llm: m.llm, text, targetSec }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
