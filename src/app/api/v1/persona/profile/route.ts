import { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import {
  PersonaProfileSchema,
  isProfileEstablished,
  parsePersonaPillars,
  parsePersonaPains,
  parsePersonaOfferings,
  parseMarketInsight,
  type PersonaProfileData,
} from '@/lib/persona/profile';

const EMPTY_PROFILE: PersonaProfileData = {
  audience: '', targetFans: '', pillars: [], angle: '', avoid: '',
  painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '',
};

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
        painPoints: parsePersonaPains(row.painPoints),
        offerings: parsePersonaOfferings(row.offerings),
        productLogic: row.productLogic ?? '',
        marketInsight: parseMarketInsight(row.marketInsight),
        systemSummary: row.systemSummary ?? '',
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

  // 十期: painPoints/offerings/productLogic/marketInsight/systemSummary 是新增字段, 校验层
  // (PersonaProfileSchema) 本身仍然要求这五个字段存在 (类型上不可省) —— 但八期已有的 PersonaCard
  // 表单只发原始 5 字段, 这里给缺省的新字段补空值再校验, 保证旧调用方不因新增字段而 400。
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const withDefaults = {
    painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '',
    ...bodyObj,
  };

  const parsed = PersonaProfileSchema.safeParse(withDefaults);
  if (!parsed.success) return fail(`档案数据不合法: ${parsed.error.message}`, 400);

  const data = {
    ...parsed.data,
    // Prisma 对可空 Json 字段的 null 写入约定 (先例见 retro-now/publish route)
    marketInsight: parsed.data.marketInsight ?? Prisma.JsonNull,
  };
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
    painPoints: parsePersonaPains(saved.painPoints),
    offerings: parsePersonaOfferings(saved.offerings),
    productLogic: saved.productLogic ?? '',
    marketInsight: parseMarketInsight(saved.marketInsight),
    systemSummary: saved.systemSummary ?? '',
  };

  return ok({ ...profile, established: isProfileEstablished(profile) });
}
