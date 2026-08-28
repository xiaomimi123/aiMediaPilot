import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { extractAwemeId, linkWorkByAwemeId } from '@/lib/works/match';

async function ownDraft(id: string) {
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!draft || draft.userId !== user.id) return null;
  return draft;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { platform?: unknown; url?: unknown; publishedAt?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!platform) return fail('platform 必填', 400);
  if (!/^https?:\/\//.test(url)) return fail('url 必须以 http(s):// 开头', 400);

  const publishedAt =
    typeof body.publishedAt === 'string' && !Number.isNaN(Date.parse(body.publishedAt))
      ? new Date(body.publishedAt)
      : new Date();
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;

  const draft = await ownDraft(id);
  if (!draft) return fail('内容不存在', 404);

  try {
    const dist = await prisma.distribution.create({
      data: { scriptDraftId: id, platform, url, publishedAt, note },
      select: { id: true },
    });

    /*
     * 登记的同时试着把回采作品对上。
     *
     * 校准要的是「预测分 vs 实际表现」的配对, 而平台不返回这层关系。链接里带作品
     * id, 回采回来的作品也带同一个 id —— 贴一次链接就能自动对上, 省掉每条都去
     * 数据页手动认领。
     *
     * 三种结果都如实回给调用方: 刚发的片子通常还没被回采到(每晚 20:00 一轮),
     * 那时候要说「等今晚」而不是假装成功。
     */
    const awemeId = platform === 'douyin' ? extractAwemeId(url) : null;
    const link = awemeId
      ? await linkWorkByAwemeId(prisma, draft.userId, awemeId, id)
      : 'no-aweme-id';

    return ok({ id: dist.id, awemeId, link });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST distributions]', e);
    return fail(`登记失败: ${msg}`, 500);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await ownDraft(id))) return fail('内容不存在', 404);

  const items = await prisma.distribution.findMany({
    where: { scriptDraftId: id },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, platform: true, url: true, publishedAt: true, note: true },
  });
  return ok({ items: items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() })) });
}
