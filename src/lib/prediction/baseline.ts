import { prisma } from '@/lib/prisma';
import type { ResolvedBaseline } from './types';

const MIN_RETROS_FOR_MEDIAN = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export async function resolveBaseline(userId: string): Promise<ResolvedBaseline | null> {
  const [user, metrics] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { baselinePlays: true } }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId } },
      select: { plays: true },
    }),
  ]);

  const retroSampleCount = metrics.length;

  if (retroSampleCount >= MIN_RETROS_FOR_MEDIAN) {
    const playsAsNumbers = metrics.map((m) => Number(m.plays));
    const m = Math.round(median(playsAsNumbers));
    // 与 onboarding 分支保持一致: baseline <= 0 视为无 baseline (formula 分子会被
    // 0 拉塌成 predicted=0/0-0, UX 上 useless)。 也不 UPDATE 0 覆盖有用的历史值。
    if (m <= 0) return null;

    // 只在 baseline 真正改变时才写 — 高频路径避免无谓 UPDATE
    if (user?.baselinePlays !== BigInt(m)) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { baselinePlays: BigInt(m) },
        });
      } catch (err) {
        console.error('[prediction/baseline] writeback failed', err);
      }
    }
    return { value: m, source: 'retro-median', retroSampleCount };
  }

  const onboardingValue = user?.baselinePlays;
  if (!onboardingValue || onboardingValue <= 0n) return null;
  return {
    value: Number(onboardingValue),
    source: 'onboarding',
    retroSampleCount,
  };
}
