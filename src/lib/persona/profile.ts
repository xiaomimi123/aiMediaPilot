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

/** 十期: 账号定位体系扩展 — 用户痛点自述。 */
export interface PersonaPain {
  pain: string;
  evidence: string;
}

/** 十期: 账号定位体系扩展 — 产品/服务供给项。 */
export interface PersonaOffering {
  name: string;
  type: 'tool' | 'service' | 'course';
  description: string;
  targetPain: string;
}

/** 十期: 账号定位体系扩展 — 市场洞察 (赛道格局/主流玩法/未满足需求/机会点)。 */
export interface PersonaMarketInsight {
  landscape: string;
  mainstream: string;
  unmet: string;
  opportunity: string;
  researchedAt: string;
}

export interface PersonaProfileData {
  audience: string;
  targetFans: string;
  pillars: PersonaPillar[];
  angle: string;
  avoid: string;
  // 十期: 账号定位体系扩展 — 全部可选, 八期已建档用户新字段为空时行为完全不变
  painPoints: PersonaPain[];
  offerings: PersonaOffering[];
  productLogic: string;
  marketInsight: PersonaMarketInsight | null;
  systemSummary: string;
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
  painPoints: z
    .array(
      z.object({
        pain: z.string().min(1).max(30),
        evidence: z.string().max(60),
      }),
    )
    .max(6),
  offerings: z
    .array(
      z.object({
        name: z.string().min(1).max(20),
        type: z.enum(['tool', 'service', 'course']),
        description: z.string().max(80),
        targetPain: z.string().max(30),
      }),
    )
    .max(5),
  productLogic: z.string().max(500),
  marketInsight: z
    .object({
      landscape: z.string().max(300),
      mainstream: z.string().max(300),
      unmet: z.string().max(300),
      opportunity: z.string().max(300),
      researchedAt: z.string(),
    })
    .nullable(),
  systemSummary: z.string().max(2000),
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

/** 防御性解析 painPoints(unknown Json) → PersonaPain[]; 非数组一律 []; 条目缺 pain 或 pain 非字符串则整条丢弃。 */
export function parsePersonaPains(json: unknown): PersonaPain[] {
  if (!Array.isArray(json)) return [];
  const result: PersonaPain[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const pain = (item as Record<string, unknown>).pain;
    if (typeof pain !== 'string' || pain.length === 0) continue;
    const evidence = (item as Record<string, unknown>).evidence;
    result.push({ pain, evidence: typeof evidence === 'string' ? evidence : '' });
  }
  return result;
}

/** 防御性解析 offerings(unknown Json) → PersonaOffering[]; 非数组一律 []; 条目缺 name 或 name 非字符串则整条丢弃。 */
export function parsePersonaOfferings(json: unknown): PersonaOffering[] {
  if (!Array.isArray(json)) return [];
  const result: PersonaOffering[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    const type = rec.type === 'tool' || rec.type === 'service' || rec.type === 'course' ? rec.type : 'tool';
    const description = typeof rec.description === 'string' ? rec.description : '';
    const targetPain = typeof rec.targetPain === 'string' ? rec.targetPain : '';
    result.push({ name, type, description, targetPain });
  }
  return result;
}

/** 防御性解析 marketInsight(unknown Json) → PersonaMarketInsight | null; 缺任一字段或非对象 → null。 */
export function parseMarketInsight(json: unknown): PersonaMarketInsight | null {
  if (!json || typeof json !== 'object') return null;
  const rec = json as Record<string, unknown>;
  const { landscape, mainstream, unmet, opportunity, researchedAt } = rec;
  if (
    typeof landscape !== 'string' ||
    typeof mainstream !== 'string' ||
    typeof unmet !== 'string' ||
    typeof opportunity !== 'string' ||
    typeof researchedAt !== 'string'
  ) {
    return null;
  }
  return { landscape, mainstream, unmet, opportunity, researchedAt };
}

/** 宽进严出: 非 'reach'|'trust'|'convert' 的一切输入 (含 null/undefined/数字/大小写不同) → ''。 */
export function validateIntent(value: unknown): '' | 'reach' | 'trust' | 'convert' {
  if (value === 'reach' || value === 'trust' || value === 'convert') return value;
  return '';
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
    painPoints: parsePersonaPains(row.painPoints),
    offerings: parsePersonaOfferings(row.offerings),
    productLogic: row.productLogic ?? '',
    marketInsight: parseMarketInsight(row.marketInsight),
    systemSummary: row.systemSummary ?? '',
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

/**
 * 十期: 雷达痛点识别 — 与 validatePillarHit 同一先例, 严格校验 AI 声称戳中的用户痛点是否
 * 真的存在于档案里 (只做 === 精确匹配, 大小写/前后空格不同都算不中), 防止 AI 编造一个听起来
 * 像但实际不存在的痛点。命中则原样返回该 pain.pain, 否则 null。
 */
export function validatePainHit(hit: unknown, pains: PersonaPain[]): string | null {
  if (typeof hit !== 'string') return null;
  const match = pains.find((p) => p.pain === hit);
  return match ? match.pain : null;
}
