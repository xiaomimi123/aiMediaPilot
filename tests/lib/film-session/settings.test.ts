import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getFilmModel, setFilmModel } from '@/lib/film-session/settings';

function fakeDb() {
  const rows = new Map<string, string>();
  return {
    appSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => void rows.set(where.key, create.value),
    },
  } as unknown as PrismaClient;
}

describe('film model setting', () => {
  it('defaults to opus and stores a choice', async () => {
    const db = fakeDb();
    expect(await getFilmModel(db)).toBe('opus');
    await setFilmModel(db, 'sonnet');
    expect(await getFilmModel(db)).toBe('sonnet');
  });
  it('rejects unknown models', async () => {
    await expect(setFilmModel(fakeDb(), 'haiku')).rejects.toThrow('出片模型只能选 Opus 或 Sonnet');
  });
});
