import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const SOURCES = ['discover', 'inspiration', 'manual'] as const;
const STATUSES = ['POOL', 'ADOPTED', 'DISCARDED'] as const;

export async function POST(req: Request) {
  let body: { title?: unknown; note?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return fail('title 必填', 400);
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;
  const source = SOURCES.includes(body.source as (typeof SOURCES)[number])
    ? (body.source as string)
    : 'manual';

  const user = await getOrCreateDefaultUser();
  const dup = await prisma.topicIdea.findFirst({
    where: { userId: user.id, status: 'POOL', title },
    select: { id: true },
  });
  if (dup) return fail('该选题已在池中', 409);

  try {
    const idea = await prisma.topicIdea.create({
      data: { userId: user.id, title, note, source },
      select: { id: true },
    });
    return ok({ id: idea.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST topics]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? 'POOL';
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return fail('status 不合法', 400);

  const user = await getOrCreateDefaultUser();
  const items = await prisma.topicIdea.findMany({
    where: { userId: user.id, status },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, title: true, note: true, source: true,
      status: true, scriptDraftId: true, createdAt: true,
    },
  });
  return ok({ items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })) });
}
