import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { detectHookPattern } from '@/lib/hooks/model';

/**
 * 把拆解结果落进库: 钩子进钩子库, 选题进灵感库。
 *
 * 拆完只是躺着没有意义 —— 这一步才是「拆解」这个板块存在的理由: 别人的写法变成
 * 你自己可检索的资产。钩子按原文去重, 重复采纳不会堆条目。
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();

  const t = await prisma.teardown.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) return fail('拆解不存在', 404);
  if (t.status !== 'done' || !t.result) return fail('这条还没拆出结果', 400);

  const result = t.result as { hooks?: string[]; topicIdeas?: string[] };
  const hooks = (result.hooks ?? []).map((s) => s.trim()).filter(Boolean);
  const topics = (result.topicIdeas ?? []).map((s) => s.trim()).filter(Boolean);

  const existing = await prisma.hook.findMany({
    where: { userId: user.id },
    select: { text: true },
  });
  const seen = new Set(existing.map((h) => h.text));
  const newHooks = hooks.filter((h) => !seen.has(h));

  if (newHooks.length > 0) {
    await prisma.hook.createMany({
      data: newHooks.map((text) => ({
        userId: user.id,
        text,
        pattern: detectHookPattern(text),
        origin: 'teardown',
      })),
    });
  }

  const now = new Date().toISOString();
  if (topics.length > 0) {
    await prisma.cockpitInspiration.createMany({
      data: topics.map((text) => ({
        id: crypto.randomUUID(),
        userId: user.id,
        text: `${text}（来自拆解：${t.title}）`,
        createdAt: now,
        updatedAt: now,
      })),
    });
  }

  return ok({ hooks: newHooks.length, topics: topics.length });
}
