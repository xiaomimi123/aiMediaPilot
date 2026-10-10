import type { PrismaClient } from '@prisma/client';

/** 写稿时带最近几篇说话样本, 每篇截前多少字(样本只用来学说话方式, 太长只会挤掉别的材料) */
export const SAMPLE_COUNT = 3;
export const SAMPLE_CHARS = 800;

export const SAMPLE_SOURCES = ['manual', 'own_script', 'transcript'] as const;
export type SampleSource = (typeof SAMPLE_SOURCES)[number];

type Db = Pick<PrismaClient, 'voiceSample'>;

export const listSamples = (db: Db) => db.voiceSample.findMany({ orderBy: { createdAt: 'desc' } });

export async function addSample(db: Db, s: { title?: string; text: string; source: string }) {
  const text = s.text.trim();
  if (!text) throw new Error('样本是空的');
  const source: SampleSource = (SAMPLE_SOURCES as readonly string[]).includes(s.source) ? (s.source as SampleSource) : 'manual';
  return db.voiceSample.create({ data: { title: (s.title ?? '').trim().slice(0, 100), text, source } });
}

export const deleteSample = (db: Db, id: string) => db.voiceSample.delete({ where: { id } });

export async function recentSampleTexts(db: Db): Promise<string[]> {
  const rows = await db.voiceSample.findMany({ orderBy: { createdAt: 'desc' }, take: SAMPLE_COUNT });
  return rows.map((r) => r.text.slice(0, SAMPLE_CHARS));
}
