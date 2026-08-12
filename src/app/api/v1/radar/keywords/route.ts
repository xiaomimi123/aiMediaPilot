import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const STATUSES = ['active', 'candidate', 'ignored'] as const;
type KeywordStatus = (typeof STATUSES)[number];

/** 全量取回后按 status 分组 — 用户词表量级很小, 一次性返回三组即可, 前端各标签页自取。 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const rows = await prisma.radarKeyword.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  const grouped: Record<KeywordStatus, typeof rows> = { active: [], candidate: [], ignored: [] };
  for (const row of rows) {
    const status = row.status as KeywordStatus;
    if (grouped[status]) grouped[status].push(row);
  }

  return ok(grouped);
}

/** 手动新增关键词 — 固定 source=manual, status=active；同用户重复 text (任意 status) → 409。 */
export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return fail('text 必填', 400);

  const user = await getOrCreateDefaultUser();
  const dup = await prisma.radarKeyword.findFirst({
    where: { userId: user.id, text },
    select: { id: true },
  });
  if (dup) return fail('该关键词已存在', 409);

  try {
    const keyword = await prisma.radarKeyword.create({
      data: { userId: user.id, text, status: 'active', source: 'manual' },
    });
    return ok({ id: keyword.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST radar/keywords]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
