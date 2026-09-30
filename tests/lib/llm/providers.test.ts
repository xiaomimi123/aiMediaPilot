import { describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ensureMigrated, maskKey, toModelView, updateModel, activateModel, createModel, ModelInputSchema, PRESETS } from '@/lib/llm/providers';

type Row = { id: string; name: string; kind: string; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: unknown };

function fakeDb(rows: Row[] = [], flags = new Set<string>()) {
  let seq = 0;
  const updates: Record<string, unknown>[] = [];
  const db = {
    appSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => (flags.has(where.key) ? { key: where.key, value: '1' } : null),
      create: async ({ data }: { data: { key: string } }) => {
        if (flags.has(data.key)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' });
        flags.add(data.key);
        return data;
      },
    },
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
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        updates.push(data as Record<string, unknown>);
        return Object.assign(rows.find((r) => r.id === where.id)!, data);
      },
      updateMany: async ({ data }: { data: Partial<Row> }) => {
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { db, rows, updates, flags };
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
  it('migrates only once even after the model is deleted', async () => {
    const { db, rows } = fakeDb();
    await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' });
    rows.length = 0;
    expect(await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })).toBe(false);
    expect(rows).toHaveLength(0);
  });
  it('two concurrent first loads create one model', async () => {
    const { db, rows } = fakeDb();
    await Promise.all([ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' }), ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })]);
    expect(rows).toHaveLength(1);
  });
  it('clears the old test result when a model is edited', async () => {
    const { db, updates } = fakeDb([row({ lastTest: { grade: 'able_agent' } })]);
    await updateModel(db, 'a', { name: 'DS', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'other', apiKey: '' });
    expect(updates.at(-1)?.lastTest).toBe(Prisma.DbNull);
  });
  it('makes the first model current when none is active', async () => {
    const { db, rows } = fakeDb();
    await createModel(db, { name: 'Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'k', apiKey: 'x' });
    expect(rows[0].isActive).toBe(true);
    await createModel(db, { name: 'GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'g', apiKey: 'y' });
    expect(rows[1].isActive).toBe(false);
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
