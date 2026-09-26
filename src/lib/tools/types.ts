import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';

/**
 * 工具层: 与界面无关。对话循环(阶段 2)和将来的 CLI 外壳(给 Claude Code / Hermes)
 * 调的是同一套工具。
 */
export interface ToolContext {
  projectId: string;
  db: PrismaClient;
  llm: StructuredLLM;
}

export interface ToolResult {
  ok: boolean;
  /** 一行人话, 显示在对话里的工具结果行 */
  summary: string;
  /** 回给模型的结构化数据 */
  data?: unknown;
  /** 本次改动的段落, 界面用来高亮 */
  segmentIds?: string[];
}

export interface Tool<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  execute(ctx: ToolContext, input: I): Promise<ToolResult>;
}

export interface PersonaLike {
  audience: string;
  targetFans: string;
  pillars: unknown;
  angle: string;
  avoid: string;
  painPoints: unknown;
  offerings: unknown;
  systemSummary: string;
}

function listLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) =>
      item && typeof item === 'object'
        ? Object.values(item as Record<string, unknown>).filter((x) => typeof x === 'string' && x).join('：')
        : String(item),
    )
    .filter(Boolean);
}

/** 人设 → 给模型读的纯文本。空字段不输出。 */
export function formatPersona(p: PersonaLike | null): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.systemSummary) parts.push(`定位摘要：${p.systemSummary}`);
  if (p.audience) parts.push(`目标受众：${p.audience}`);
  if (p.targetFans) parts.push(`想吸引的粉丝：${p.targetFans}`);
  const pillars = listLines(p.pillars);
  if (pillars.length) parts.push(`内容支柱：\n${pillars.map((x) => `- ${x}`).join('\n')}`);
  if (p.angle) parts.push(`差异化角度：${p.angle}`);
  const pains = listLines(p.painPoints);
  if (pains.length) parts.push(`受众痛点：\n${pains.map((x) => `- ${x}`).join('\n')}`);
  const offers = listLines(p.offerings);
  if (offers.length) parts.push(`商品/服务：\n${offers.map((x) => `- ${x}`).join('\n')}`);
  if (p.avoid) parts.push(`忌讳：${p.avoid}`);
  return parts.join('\n');
}
