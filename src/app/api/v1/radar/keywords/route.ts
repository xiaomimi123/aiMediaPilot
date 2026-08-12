import { Prisma } from '@prisma/client';
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
    // R4 终审修复: 上面的 findFirst 预检查只是"友好路径"（省一次报错往返），
    // 但两次请求之间存在 TOCTOU 窗口——并发提交同一关键词时都能通过 findFirst，
    // 最终由 `@@unique([userId, text])`（本次一并加到 schema）兜底拒绝其中一条。
    // 命中该约束时复用与预检查完全相同的 409 文案，前端无需区分是哪条路径命中。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return fail('该关键词已存在', 409);
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST radar/keywords]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
