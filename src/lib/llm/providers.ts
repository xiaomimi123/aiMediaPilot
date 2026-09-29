import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';

export type ProviderKind = 'openai' | 'anthropic';

export interface ModelTestResult {
  at: string;
  reachable: boolean;
  tools: boolean;
  json: boolean;
  grade: 'able_agent' | 'analysis_only' | 'unusable';
  message: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
  lastTest: ModelTestResult | null;
}

/** 只预填接口地址与类型; 模型名由用户填(各家更新快, 不写死) */
export const PRESETS: { key: string; name: string; kind: ProviderKind; baseUrl: string; keyOptional?: boolean; note?: string }[] = [
  { key: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { key: 'qwen', name: '通义千问', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', note: '国内站地址; 国际站用 https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { key: 'kimi', name: 'Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', note: '国内站地址; 国际站用 https://api.moonshot.ai/v1' },
  { key: 'glm', name: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'doubao', name: '豆包（火山方舟）', kind: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', note: '模型名填方舟里的接入点 ID 或模型 ID' },
  { key: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { key: 'ollama', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', keyOptional: true, note: '先在本机运行 Ollama 并拉取模型' },
  { key: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { key: 'custom', name: '自定义 / 中转站', kind: 'openai', baseUrl: '', note: '中转站若把 Claude 包装成 OpenAI 格式, 选 OpenAI 兼容即可' },
];

export const ModelInputSchema = z.object({
  name: z.string().trim().min(1, '起个名字').max(30, '名字太长了'),
  kind: z.enum(['openai', 'anthropic']),
  baseUrl: z.string().trim().url('接口地址要以 http:// 或 https:// 开头'),
  model: z.string().trim().min(1, '填模型名'),
  apiKey: z.string().trim().optional(),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;

export function maskKey(k: string): string {
  return k ? `…${k.slice(-4)}` : '（无）';
}

export interface ModelView {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  keyMasked: string;
  isActive: boolean;
  lastTest: ModelTestResult | null;
}

export function toModelView(c: ModelConfig): ModelView {
  return { id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, model: c.model, keyMasked: maskKey(c.apiKey), isActive: c.isActive, lastTest: c.lastTest };
}

type Row = { id: string; name: string; kind: string; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: unknown };
const toConfig = (r: Row): ModelConfig => ({ ...r, kind: r.kind === 'anthropic' ? 'anthropic' : 'openai', lastTest: (r.lastTest as ModelTestResult | null) ?? null });

export async function listModels(db: PrismaClient): Promise<ModelConfig[]> {
  return (await db.modelProvider.findMany({ orderBy: { createdAt: 'asc' } })).map(toConfig);
}

export async function getActiveConfig(db: PrismaClient): Promise<ModelConfig | null> {
  const r = await db.modelProvider.findFirst({ where: { isActive: true } });
  return r ? toConfig(r) : null;
}

export async function createModel(db: PrismaClient, input: ModelInput): Promise<ModelConfig> {
  const r = await db.modelProvider.create({ data: { name: input.name, kind: input.kind, baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey ?? '' } });
  return toConfig(r);
}

export async function updateModel(db: PrismaClient, id: string, input: ModelInput): Promise<ModelConfig> {
  const r = await db.modelProvider.update({
    where: { id },
    // key 留空 = 不改; 改了地址/模型要重新测试
    data: { name: input.name, kind: input.kind, baseUrl: input.baseUrl, model: input.model, ...(input.apiKey ? { apiKey: input.apiKey } : {}), lastTest: undefined },
  });
  return toConfig(r);
}

export async function deleteModel(db: PrismaClient, id: string): Promise<void> {
  await db.modelProvider.delete({ where: { id } });
}

export async function activateModel(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction([db.modelProvider.updateMany({ data: { isActive: false } }), db.modelProvider.update({ where: { id }, data: { isActive: true } })]);
}

export async function saveTestResult(db: PrismaClient, id: string, r: ModelTestResult): Promise<void> {
  await db.modelProvider.update({ where: { id }, data: { lastTest: r as unknown as Prisma.InputJsonValue } });
}

/** 表为空且 .env 有 DeepSeek key → 建一条并设为当前; 只做一次 */
export async function ensureMigrated(db: PrismaClient, env: { DEEPSEEK_API_KEY?: string }): Promise<boolean> {
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key || (await db.modelProvider.count()) > 0) return false;
  await db.modelProvider.create({ data: { name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: key, isActive: true } });
  return true;
}
