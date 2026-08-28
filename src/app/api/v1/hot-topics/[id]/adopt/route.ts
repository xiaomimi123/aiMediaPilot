import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 把一条抖音热搜存进灵感库。
 *
 * 存的是**原样的热搜词**, 不做「AI 改写成选题角度」—— 雷达那条路已经证明了改写
 * 的问题: 改出来的角度是模型的, 不是你的。热搜词本身就够具体了
 * (「30岁了一事无成的人该做什么工作」), 怎么切是你写稿时的判断。
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();

  const topic = await prisma.douyinHotTopic.findUnique({ where: { id } });
  if (!topic || topic.userId !== user.id) return fail('热搜不存在', 404);
  if (topic.adoptedAt) return fail('这条已经存过了', 400);

  const text = `${topic.title}（抖音热搜，热度 ${topic.hotValue.toLocaleString()}）`;
  // 这张表的 id / updatedAt 没有数据库默认值(cockpit 移植过来时保留了原样), 要显式给
  const now = new Date().toISOString();
  const created = await prisma.cockpitInspiration.create({
    data: { id: crypto.randomUUID(), userId: user.id, text, createdAt: now, updatedAt: now },
    select: { id: true },
  });
  await prisma.douyinHotTopic.update({ where: { id }, data: { adoptedAt: new Date() } });

  return ok({ inspirationId: created.id });
}
