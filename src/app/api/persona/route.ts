import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const parsed = row ? PersonaSchema.safeParse(row) : null;
  return ok(parsed?.success ? parsed.data : EMPTY_PERSONA);
}

export async function PUT(req: Request) {
  const parsed = PersonaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '内容格式不对', 400);
  const p = parsed.data;
  const data = {
    audience: p.audience,
    targetFans: p.targetFans,
    angle: p.angle,
    avoid: p.avoid,
    systemSummary: p.systemSummary,
    pillars: p.pillars as unknown as Prisma.InputJsonValue,
    painPoints: p.painPoints as unknown as Prisma.InputJsonValue,
    offerings: p.offerings as unknown as Prisma.InputJsonValue,
  };
  await prisma.personaProfile.upsert({ where: { id: 'me' }, update: data, create: { id: 'me', ...data } });
  return ok(p);
}
