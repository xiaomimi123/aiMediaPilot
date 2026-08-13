import { z } from 'zod';
import { prisma } from '@/lib/prisma';

/**
 * 人设定位档案 —「谁在看/想吸引谁/讲什么/为什么不一样/不做什么」的结构化自述,
 * 供选题生成 (buildPersonaSection) 与命中校验 (validatePillarHit) 消费。
 *
 * PersonaProfile 没有 User 反向关系 (学 StyleProfile/RadarConfig 先例), 一律
 * `prisma.personaProfile.findUnique({ where: { userId } })` 直查, 不走 `user.personaProfile`。
 */

export interface PersonaPillar {
  name: string;
  description: string;
}

export interface PersonaProfileData {
  audience: string;
  targetFans: string;
  pillars: PersonaPillar[];
  angle: string;
  avoid: string;
}

export const PersonaProfileSchema = z.object({
  audience: z.string().max(300),
  targetFans: z.string().max(300),
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).max(10),
        description: z.string().max(60),
      }),
    )
    .max(5),
  angle: z.string().max(300),
  avoid: z.string().max(300),
});

/** 建立门槛: 至少填了受众 + 至少 1 条内容支柱, 才算「已建立」的档案。 */
export function isProfileEstablished(p: PersonaProfileData): boolean {
  return p.audience.trim().length > 0 && p.pillars.length >= 1;
}

/** 防御性解析 pillars(unknown Json) → PersonaPillar[]; 非数组一律 []; 条目缺 name 或 name 非字符串则整条丢弃。 */
export function parsePersonaPillars(json: unknown): PersonaPillar[] {
  if (!Array.isArray(json)) return [];
  const result: PersonaPillar[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as Record<string, unknown>).name;
    if (typeof name !== 'string' || name.length === 0) continue;
    const description = (item as Record<string, unknown>).description;
    result.push({ name, description: typeof description === 'string' ? description : '' });
  }
  return result;
}

/**
 * 供选题/写稿等下游消费的读取入口 — 无行或档案未建立一律返回 null (调用方按「没有人设」兜底),
 * 避免半填状态的档案被当作可用上下文注入 prompt。
 */
export async function loadPersonaProfile(userId: string): Promise<PersonaProfileData | null> {
  const row = await prisma.personaProfile.findUnique({ where: { userId } });
  if (!row) return null;

  const profile: PersonaProfileData = {
    audience: row.audience,
    targetFans: row.targetFans,
    pillars: parsePersonaPillars(row.pillars),
    angle: row.angle,
    avoid: row.avoid,
  };
  return isProfileEstablished(profile) ? profile : null;
}

/**
 * 严格校验 AI 声称命中的内容支柱是否真的存在 — 只做 === 精确匹配 (大小写/前后空格不同都算不中),
 * 防止 AI 编造一个听起来像但实际不存在的支柱名。命中则原样返回该 pillar.name, 否则 null。
 */
export function validatePillarHit(hit: unknown, pillars: PersonaPillar[]): string | null {
  if (typeof hit !== 'string') return null;
  const match = pillars.find((p) => p.name === hit);
  return match ? match.name : null;
}
