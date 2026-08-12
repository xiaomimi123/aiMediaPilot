import { randomUUID } from 'crypto';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

const ACTIONS = ['adopt', 'ignore'] as const;

/**
 * 雷达条目 采纳/忽略。
 *
 * adopt 是本期 (四期 T5) 唯一一条把雷达数据写进 cockpit 的路径：
 * 把条目转成一条 CockpitInspiration (text = title + angle + summary + url 拼接)，
 * 同事务 bump cockpit rev —— 与 `cockpit/inspirations` POST 同样的理由 (见该文件
 * 注释): 这是本请求的主写入而非旁路 hook，若 bump 失败必须连带 create/update 一起
 * 回滚，不能 fail-soft 吞掉——否则会出现"灵感已落库但 cockpit rev 未失效"的窗口，
 * 已打开的标签页仍持有旧 rev，下次整页保存会悄悄覆盖掉这条刚采纳的灵感。
 * RadarItem 状态更新 (status: adopted, inspirationId) 也纳入同一事务，保证
 * "灵感已创建但条目仍显示 new" 的不一致状态不会出现。
 *
 * T6 幂等守卫 (T5 Minor 遗留闭合, 见 progress.md「Task 5」): item.status !== 'new'
 * 时一律 409 拒绝，不重复写。此前无该守卫时双击「收入灵感库」会因为两次请求都读到
 * status='new' 而各自建一条 CockpitInspiration —— 产生孤儿灵感卡 (第二条 inspirationId
 * 覆盖第一条, 第一条的灵感卡再也无法从雷达条目追溯回去)。前端另加 pending 态禁用双击
 * 是第一道防线, 这里是服务端兜底 (网络重试/多标签页等 UI 层防不住的场景)。
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const action = body.action;
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) return fail('action 不合法', 400);

  const user = await getOrCreateDefaultUser();
  const item = await prisma.radarItem.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, aiAngle: true, aiSummary: true, url: true, status: true },
  });
  if (!item || item.userId !== user.id) return fail('雷达条目不存在', 404);
  if (item.status !== 'new') return fail('该条目已处理', 409);

  if (action === 'ignore') {
    await prisma.radarItem.update({ where: { id }, data: { status: 'ignored' } });
    return ok({ id, status: 'ignored' });
  }

  // action === 'adopt'
  try {
    const inspirationId = randomUUID();
    const now = new Date().toISOString();
    const text = `${item.title}\n${item.aiAngle}\n${item.aiSummary}\n${item.url}`;

    await prisma.$transaction(async (tx) => {
      await tx.cockpitInspiration.create({
        data: {
          id: inspirationId,
          userId: user.id,
          text,
          convertedContentIds: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      await bumpCockpitRev(user.id, tx);
      await tx.radarItem.update({
        where: { id },
        data: { status: 'adopted', inspirationId },
      });
    });

    return ok({ id, status: 'adopted', inspirationId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PATCH radar/items/:id adopt]', e);
    return fail(`采纳失败: ${msg}`, 500);
  }
}
