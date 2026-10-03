import type { PrismaClient } from '@prisma/client';
import { DEFAULT_FILM_MODEL, FILM_MODELS } from './args';

const KEY = 'film.model';
export type FilmModel = (typeof FILM_MODELS)[number];

export async function getFilmModel(db: PrismaClient): Promise<FilmModel> {
  const v = (await db.appSetting.findUnique({ where: { key: KEY } }))?.value;
  return (FILM_MODELS as readonly string[]).includes(v ?? '') ? (v as FilmModel) : DEFAULT_FILM_MODEL;
}

export async function setFilmModel(db: PrismaClient, v: string): Promise<void> {
  if (!(FILM_MODELS as readonly string[]).includes(v)) throw new Error('出片模型只能选 Opus 或 Sonnet');
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: v }, update: { value: v } });
}
