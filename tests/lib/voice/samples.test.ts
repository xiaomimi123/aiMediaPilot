import { describe, expect, it } from 'vitest';
import { addSample, deleteSample, listSamples, recentSampleTexts, SAMPLE_CHARS } from '@/lib/voice/samples';

type Row = { id: string; title: string; text: string; source: string; createdAt: Date };

function fakeDb() {
  const rows: Row[] = [];
  let n = 0;
  const sorted = () => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const db = {
    voiceSample: {
      findMany: async (q: { take?: number }) => sorted().slice(0, q?.take ?? rows.length),
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
        n += 1;
        const r = { id: `v${n}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)), ...data } as Row;
        rows.push(r);
        return r;
      },
      delete: async ({ where }: { where: { id: string } }) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)[0],
    },
  };
  return { db: db as never, rows };
}

describe('voice samples', () => {
  it('uses the latest 3 samples trimmed to 800 characters', async () => {
    const { db } = fakeDb();
    for (let i = 1; i <= 4; i++) await addSample(db, { text: `样本${i}` , source: 'manual' });
    await addSample(db, { text: '长'.repeat(1000), source: 'manual' });
    const texts = await recentSampleTexts(db);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toHaveLength(SAMPLE_CHARS);
    expect(texts.slice(1)).toEqual(['样本4', '样本3']);
  });

  it('rejects an empty sample', async () => {
    const { db } = fakeDb();
    await expect(addSample(db, { text: '  \n ', source: 'manual' })).rejects.toThrow('样本是空的');
  });

  it('adds and deletes', async () => {
    const { db } = fakeDb();
    const s = await addSample(db, { title: ' 两年半 ', text: ' 正文 ', source: 'own_script' });
    expect(s).toMatchObject({ title: '两年半', text: '正文', source: 'own_script' });
    expect(await listSamples(db)).toHaveLength(1);
    await deleteSample(db, s.id);
    expect(await listSamples(db)).toHaveLength(0);
  });

  it('records unknown sources as manual', async () => {
    const { db } = fakeDb();
    expect((await addSample(db, { text: 'x', source: 'hack' })).source).toBe('manual');
  });
});
