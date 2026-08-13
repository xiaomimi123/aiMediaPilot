import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { PersonaProfileSchema, isProfileEstablished, parsePersonaPillars, type PersonaProfileData } from '@/lib/persona/profile';

const EMPTY_PROFILE: PersonaProfileData = { audience: '', targetFans: '', pillars: [], angle: '', avoid: '' };

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const row = await prisma.personaProfile.findUnique({ where: { userId: user.id } });

  const profile: PersonaProfileData = row
    ? {
        audience: row.audience,
        targetFans: row.targetFans,
        pillars: parsePersonaPillars(row.pillars),
        angle: row.angle,
        avoid: row.avoid,
      }
    : EMPTY_PROFILE;

  return ok({ ...profile, established: isProfileEstablished(profile) });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = PersonaProfileSchema.safeParse(body);
  if (!parsed.success) return fail(`档案数据不合法: ${parsed.error.message}`, 400);

  const data = parsed.data;
  const user = await getOrCreateDefaultUser();
  const saved = await prisma.personaProfile.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, ...data },
  });

  const profile: PersonaProfileData = {
    audience: saved.audience,
    targetFans: saved.targetFans,
    pillars: parsePersonaPillars(saved.pillars),
    angle: saved.angle,
    avoid: saved.avoid,
  };

  return ok({ ...profile, established: isProfileEstablished(profile) });
}
