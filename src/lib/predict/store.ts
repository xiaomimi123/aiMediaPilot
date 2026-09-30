import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_PARAMS, type FormulaParams } from './formula';

export async function ensureActiveFormula(db: PrismaClient): Promise<{ version: number; params: FormulaParams }> {
  const active = await db.predictionFormula.findFirst({ where: { status: 'active' }, orderBy: { version: 'desc' } });
  if (active) return { version: active.version, params: active.params as unknown as FormulaParams };
  const created = await db.predictionFormula.upsert({ where: { version: 1 }, update: {}, create: { version: 1, params: DEFAULT_PARAMS as unknown as Prisma.InputJsonValue, status: 'active' } });
  return { version: created.version, params: created.params as unknown as FormulaParams };
}

/** 有效样本数 = 已对账的项目数(每个项目一条) */
export async function calibratedCount(db: PrismaClient): Promise<number> {
  const rows = await db.predictionCheck.findMany({ select: { prediction: { select: { projectId: true } } } });
  return new Set(rows.map((r) => r.prediction.projectId)).size;
}
