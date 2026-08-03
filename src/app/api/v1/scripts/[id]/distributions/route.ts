import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

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

  if (!(await ownDraft(id))) return fail('内容不存在', 404);

  try {
    const dist = await prisma.distribution.create({
      data: { scriptDraftId: id, platform, url, publishedAt, note },
      select: { id: true },
    });
    return ok({ id: dist.id });
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
