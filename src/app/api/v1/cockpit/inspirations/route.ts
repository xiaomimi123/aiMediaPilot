import { randomUUID } from 'crypto';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text || text.length > 2000) return fail('text 需为 1-2000 字', 400);

  const user = await getOrCreateDefaultUser();

  try {
    const now = new Date().toISOString();
    const inspiration = await prisma.cockpitInspiration.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        text,
        convertedContentIds: [],
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });

    // 就地写入的是 CockpitInspiration, 不经过 saveWorkspaceToDb — 敲一下
    // prefs.updatedAt, 让已打开的 cockpit 标签页 rev 失效, 下次整页保存走 409
    // 重新加载, 而不是静默用旧状态把这里刚存入的灵感覆盖掉。
    await bumpCockpitRev(user.id);

    return ok({ id: inspiration.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST cockpit/inspirations]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
