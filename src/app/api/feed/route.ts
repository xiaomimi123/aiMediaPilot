import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { dismissDaily } from '@/lib/topics/daily';

export const dynamic = 'force-dynamic';

/** 列表上的忽略 / 恢复。只改状态，不编造新字段。 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; kind?: string; id?: string };
  const id = String(b.id ?? '');
  if (!id) return fail('缺少 id', 400);
  try {
    if (b.kind === 'source') {
      const item = await prisma.sourceItem.findUnique({ where: { id } });
      if (!item) return fail('找不到这条', 404);
      if (b.action === 'dismiss') {
        await prisma.sourceItem.update({ where: { id }, data: { status: 'dismissed' } });
        await prisma.dailyTopic.updateMany({ where: { source: 'source', sourceId: id, status: 'new' }, data: { status: 'dismissed' } });
        return ok({ status: 'dismissed' });
      }
      if (b.action === 'restore') {
        const daily = await prisma.dailyTopic.findFirst({ where: { source: 'source', sourceId: id, status: { not: 'dismissed' } } });
        await prisma.sourceItem.update({ where: { id }, data: { status: daily ? 'used' : 'fresh' } });
        return ok({ status: daily ? 'used' : 'fresh' });
      }
    } else if (b.kind === 'benchmark') {
      const video = await prisma.benchmarkVideo.findUnique({ where: { id } });
      if (!video) return fail('找不到这条', 404);
      if (b.action === 'dismiss') {
        await prisma.benchmarkVideo.update({ where: { id }, data: { status: 'ignored' } });
        await prisma.dailyTopic.updateMany({ where: { source: 'benchmark', sourceId: id, status: 'new' }, data: { status: 'dismissed' } });
        return ok({ status: 'dismissed' });
      }
      if (b.action === 'restore') {
        await prisma.benchmarkVideo.update({ where: { id }, data: { status: 'new' } });
        return ok({ status: 'new' });
      }
    } else if (b.kind === 'daily') {
      if (b.action === 'dismiss') {
        await dismissDaily(prisma, id);
        return ok({ status: 'dismissed' });
      }
      if (b.action === 'restore') {
        const r = await prisma.dailyTopic.updateMany({ where: { id, status: 'dismissed' }, data: { status: 'new' } });
        if (!r.count) return fail('这个选题已经处理过了', 409);
        return ok({ status: 'new' });
      }
    }
    return fail('action 不对', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}
