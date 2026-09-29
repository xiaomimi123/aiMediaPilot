import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ensureMigrated, maskKey, toModelView, updateModel, activateModel, ModelInputSchema, PRESETS } from '@/lib/llm/providers';

type Row = { id: string; name: string; kind: string; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: unknown };

function fakeDb(rows: Row[] = []) {
  let seq = 0;
  const db = {
    modelProvider: {
      count: async () => rows.length,
      findMany: async () => rows.map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { isActive: boolean } }) => rows.find((r) => r.isActive === where.isActive) ?? null,
      create: async ({ data }: { data: Partial<Omit<Row, 'id'>> }) => {
        const r = { id: `m${++seq}`, ...{ lastTest: null, isActive: false, apiKey: '' }, ...data } as Row;
        rows.push(r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      updateMany: async ({ data }: { data: Partial<Row> }) => {
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { db, rows };
}

const row = (o: Partial<Row>): Row => ({ id: 'a', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890abcd', model: 'deepseek-chat', isActive: false, lastTest: null, ...o });

describe('providers', () => {
  it('migrates the .env DeepSeek key once', async () => {
    const { db, rows } = fakeDb();
    expect(await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })).toBe(true);
    expect(rows[0]).toMatchObject({ name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-abc', isActive: true });
    expect(await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })).toBe(false);
    expect(rows).toHaveLength(1);
  });
  it('does nothing without a .env key', async () => {
    const { db, rows } = fakeDb();
    expect(await ensureMigrated(db, {})).toBe(false);
    expect(rows).toHaveLength(0);
  });
  it('masks keys and never exposes them in views', () => {
    expect(maskKey('sk-1234567890abcd')).toBe('…abcd');
    expect(maskKey('')).toBe('（无）');
    const v = toModelView(row({}) as never);
    expect(JSON.stringify(v)).not.toContain('sk-1234567890abcd');
    expect(v.keyMasked).toBe('…abcd');
  });
  it('keeps the stored key when the edit leaves it blank', async () => {
    const { db, rows } = fakeDb([row({})]);
    await updateModel(db, 'a', { name: 'DS', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' });
    expect(rows[0]).toMatchObject({ name: 'DS', apiKey: 'sk-1234567890abcd' });
  });
  it('activates exactly one model', async () => {
    const { db, rows } = fakeDb([row({ id: 'a', isActive: true }), row({ id: 'b' })]);
    await activateModel(db, 'b');
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });
  it('validates input', () => {
    expect(ModelInputSchema.safeParse({ name: 'x', kind: 'openai', baseUrl: 'not a url', model: 'm' }).success).toBe(false);
    expect(ModelInputSchema.safeParse({ name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' }).success).toBe(true);
  });
  it('has presets for every provider in the spec', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['deepseek', 'qwen', 'kimi', 'glm', 'doubao', 'openrouter', 'ollama', 'claude', 'custom']);
  });
});
