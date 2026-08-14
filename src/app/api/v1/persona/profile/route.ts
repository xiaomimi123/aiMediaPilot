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

  const user = await getOrCreateDefaultUser();

  // 十期: painPoints/offerings/productLogic/marketInsight/systemSummary 是新增字段, 校验层
  // (PersonaProfileSchema) 本身仍然要求这五个字段存在 (类型上不可省)。八期已有的 PersonaCard
  // 表单只发原始 5 字段 —— 这里对**新增字段**做合并语义: 请求体里显式提供 (哪怕是 ''/[]/null
  // 这种"看起来像默认值"的显式覆盖) 才采用请求体的值, 未提供的 key 从现有行读回并保留原值
  // (不是硬编码空值覆盖, 否则旧表单每次保存都会静默清空这些新字段, T3 起草产出的数据会被
  // T6 UI 上线前的每次八期表单保存冲掉)。无现有行 (首次保存) 时未提供的新字段才用空默认值。
  // 注意: 这个合并只作用于新增的 5 个字段, 八期原始 5 字段维持"PUT 全量覆盖"语义不变。
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const existing = await prisma.personaProfile.findUnique({ where: { userId: user.id } });
  const NEW_FIELD_FALLBACKS: Record<string, unknown> = existing
    ? {
        painPoints: parsePersonaPains(existing.painPoints),
        offerings: parsePersonaOfferings(existing.offerings),
        productLogic: existing.productLogic ?? '',
        marketInsight: parseMarketInsight(existing.marketInsight),
        systemSummary: existing.systemSummary ?? '',
      }
    : { painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '' };
  const merged: Record<string, unknown> = { ...bodyObj };
  for (const key of Object.keys(NEW_FIELD_FALLBACKS)) {
    if (!(key in bodyObj)) merged[key] = NEW_FIELD_FALLBACKS[key];
  }

  const parsed = PersonaProfileSchema.safeParse(merged);
  if (!parsed.success) return fail(`档案数据不合法: ${parsed.error.message}`, 400);

  const data = {
    ...parsed.data,
    // Prisma 对可空 Json 字段的 null 写入约定 (先例见 retro-now/publish route)
    marketInsight: parsed.data.marketInsight ?? Prisma.JsonNull,
  };
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
