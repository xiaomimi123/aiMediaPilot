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
    const id = randomUUID();

    // 这里的 cockpit 写入本身就是本路由的主操作 (不像 picked/auto-sync/retro-worker
    // 那样是"次要旁路" hook), 所以 bump 不能 fail-soft: 若单独吞掉 bump 异常,
    // 会出现「行已落库但 prefs.updatedAt 未被敲」的窗口 —— 已打开的标签页仍持有
    // 旧 rev, 下次整页保存会用旧状态悄悄覆盖掉刚存入的这条灵感 (重开 I1 的丢数据
    // 窗口)。用同一个事务把 create + bump 绑定为原子操作: bump 失败则整体回滚,
    // fail(500) 如实反映"没有落库", 客户端可安全重试。
    await prisma.$transaction(async (tx) => {
      await tx.cockpitInspiration.create({
        data: {
          id,
          userId: user.id,
          text,
          convertedContentIds: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      await bumpCockpitRev(user.id, tx);
    });

    return ok({ id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST cockpit/inspirations]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
