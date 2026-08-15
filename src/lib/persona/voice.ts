import { z } from 'zod';
import { prisma } from '@/lib/prisma';

/**
 * 人物志 —「你是谁」的结构化自述 (来路/身份/我不是什么/立场/情绪基调),
 * 供写稿注入 (buildVoiceSection) 与体系报告消费。
 *
 * 与 PersonaProfile 的分工: PersonaProfile 管「你做什么生意」(受众/支柱/痛点/
 * 商品服务/产品逻辑/市场), CreatorVoice 管「你是谁」。
 *
 * **语言层 (口吻/句式/口头禅) 不在这里** —— 完全归 StyleProfile + StyleSample。
 * 两处都写会让写稿 prompt 收到自相矛盾的指令, 十二期设计明确切分 (spec §0/§4)。
 *
 * CreatorVoice 没有 User 反向关系 (学 StyleProfile/PersonaProfile 先例), 一律
 * `prisma.creatorVoice.findUnique({ where: { userId } })` 直查。
 */

export interface VoiceStance {
  /** 主张本身, 允许得罪人 */
  claim: string;
  /** 为什么这么认为 */
  reason: string;
}

export interface CreatorVoiceData {
  origin: string;
  identity: string;
  notIdentity: string;
  stances: VoiceStance[];
  energy: string;
}

export const CreatorVoiceSchema = z.object({
  origin: z.string().max(500),
  identity: z.string().max(200),
  notIdentity: z.string().max(200),
  stances: z
    .array(
      z.object({
        claim: z.string().min(1).max(50),
        reason: z.string().max(100),
      }),
    )
    .max(5),
  energy: z.string().max(200),
});

/**
 * 建立门槛: 只看 identity —— 它是「你是谁」的最小要素, 缺了它注入无意义。
 * 其余字段全部可选 (来路/立场/情绪基调都可以后补)。
 */
export function isVoiceEstablished(v: CreatorVoiceData): boolean {
  return v.identity.trim().length > 0;
}

/** 防御性解析 stances(unknown Json) → VoiceStance[]; 非数组一律 []; 条目缺 claim 或 claim 非字符串则整条丢弃。 */
export function parseVoiceStances(json: unknown): VoiceStance[] {
  if (!Array.isArray(json)) return [];
  const result: VoiceStance[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const claim = (item as Record<string, unknown>).claim;
    if (typeof claim !== 'string' || claim.length === 0) continue;
    const reason = (item as Record<string, unknown>).reason;
    result.push({ claim, reason: typeof reason === 'string' ? reason : '' });
  }
  return result;
}

export const EMPTY_VOICE: CreatorVoiceData = {
  origin: '',
  identity: '',
  notIdentity: '',
  stances: [],
  energy: '',
};

/** 读人物志; 无行或未建立 (identity 空) 一律返回 null —— 调用方据此走「零迁移」降级路径。 */
export async function loadCreatorVoice(userId: string): Promise<CreatorVoiceData | null> {
  const row = await prisma.creatorVoice.findUnique({ where: { userId } });
  if (!row) return null;
  const data: CreatorVoiceData = {
    origin: row.origin,
    identity: row.identity,
    notIdentity: row.notIdentity,
    stances: parseVoiceStances(row.stances),
    energy: row.energy,
  };
  return isVoiceEstablished(data) ? data : null;
}

// ---------------------------------------------------------------------------
// 个人经历库
// ---------------------------------------------------------------------------

export const EXPERIENCE_KINDS = ['practice', 'failure', 'insight', 'result'] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];

/** 中文标签 —— UI 与 prompt 共用, 避免两处各写一套。 */
export const EXPERIENCE_KIND_LABELS: Record<ExperienceKind, string> = {
  practice: '实践',
  failure: '翻车',
  insight: '认知刷新',
  result: '成果',
};

export interface ExperienceItem {
  id: string;
  /** 用户随手记的原话, 不改写 */
  content: string;
  topic: string;
  /** '' 表示打标签失败或未分类 —— 不因打标签失败丢掉用户记的内容 */
  kind: string;
  keywords: string[];
  usedCount: number;
  /** ISO 字符串 */
  createdAt: string;
}

/** 宽进严出: 合法 kind 原样返回, 其余 (含 null/undefined/大小写不同) 一律 ''。 */
export function validateExperienceKind(v: unknown): string {
  if (typeof v !== 'string') return '';
  return (EXPERIENCE_KINDS as readonly string[]).includes(v) ? v : '';
}

/** 防御性解析 keywords(unknown Json) → string[]; 非数组一律 []; 非字符串/空串条目丢弃。 */
export function parseExperienceKeywords(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
}

/** 读经历库, 按 createdAt 降序 (新的在前 —— matchExperiences 的新鲜度排序依赖它)。 */
export async function loadExperiences(userId: string): Promise<ExperienceItem[]> {
  const rows = await prisma.creatorExperience.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    topic: r.topic,
    kind: validateExperienceKind(r.kind),
    keywords: parseExperienceKeywords(r.keywords),
    usedCount: r.usedCount,
    createdAt: r.createdAt.toISOString(),
  }));
}
