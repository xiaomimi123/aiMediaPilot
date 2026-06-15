import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const MAX_BASELINE = 1e8;

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const value = (body as { value?: unknown })?.value;

  if (value === null) {
    try {
      const user = await getOrCreateDefaultUser();
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { baselinePlays: null },
      });
      return ok({ baselinePlays: updated.baselinePlays?.toString() ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[PUT user/baseline] clear failed', e);
      return fail(`保存失败: ${msg}`, 500);
    }
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_BASELINE) {
    return fail(`baselinePlays 必须是 0 < value ≤ ${MAX_BASELINE} 的数字, 或 null`, 400);
  }

  try {
    const user = await getOrCreateDefaultUser();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { baselinePlays: BigInt(Math.round(value)) },
    });
    return ok({ baselinePlays: updated.baselinePlays?.toString() ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT user/baseline] set failed', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
