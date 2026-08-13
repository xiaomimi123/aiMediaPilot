import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const DESCRIPTION_MAX_LEN = 2000;

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const profile = await prisma.styleProfile.findUnique({ where: { userId: user.id } });
  return ok({ description: profile?.description ?? '' });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const description = (body as Record<string, unknown> | null)?.description;
  if (typeof description !== 'string') return fail('description 必须是字符串', 400);
  if (description.length > DESCRIPTION_MAX_LEN) return fail(`description 不能超过 ${DESCRIPTION_MAX_LEN} 字`, 400);

  const user = await getOrCreateDefaultUser();
  const saved = await prisma.styleProfile.upsert({
    where: { userId: user.id },
    update: { description },
    create: { userId: user.id, description },
  });

  return ok({ description: saved.description });
}
