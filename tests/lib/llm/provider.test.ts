import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildModel, getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import type { ModelConfig } from '@/lib/llm/providers';

const cfg = (o: Partial<ModelConfig> = {}): ModelConfig => ({ id: 'm1', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat', isActive: true, lastTest: null, ...o });

describe('provider', () => {
  it('labels the model with name and model id', () => {
    const m = buildModel(cfg());
    expect(m.label).toBe('DeepSeek（deepseek-chat）');
    expect(m.chat.label).toBe('DeepSeek（deepseek-chat）');
    expect(typeof m.llm.callStructured).toBe('function');
  });
  it('works without a key (ollama)', () => {
    expect(() => buildModel(cfg({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' }))).not.toThrow();
  });
  it('returns null when there is no active model and nothing to migrate', async () => {
    const db = { modelProvider: { count: async () => 0, findFirst: async () => null } } as unknown as PrismaClient;
    expect(await getActiveModel(db, {})).toBeNull();
    expect(NO_MODEL_MESSAGE).toBe('还没有可用的模型：去设置页添加一个。');
  });
});
