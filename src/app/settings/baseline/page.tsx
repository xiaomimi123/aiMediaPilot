import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { BaselineForm } from '@/components/settings/baseline-form';

const MIN_RETROS_FOR_MEDIAN = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

const SOURCE_LABEL = {
  null: '尚未设置',
  onboarding: '你 onboarding 填的',
  'retro-median': '自动从复盘 median 算出',
} as const;

export default async function BaselineSettingsPage() {
  const user = await getOrCreateDefaultUser();
  const [fresh, metrics] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { baselinePlays: true },
    }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId: user.id } },
      select: { plays: true },
    }),
  ]);

  const retroCount = metrics.length;
  const retroMedian =
    retroCount >= MIN_RETROS_FOR_MEDIAN
      ? Math.round(median(metrics.map((m) => Number(m.plays))) ?? 0)
      : null;

  const initialValue = fresh?.baselinePlays?.toString() ?? null;
  const currentLabel =
    initialValue === null
      ? SOURCE_LABEL.null
      : retroMedian !== null && Math.round(retroMedian) === Number(initialValue)
        ? SOURCE_LABEL['retro-median']
        : SOURCE_LABEL.onboarding;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">账号基线</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          这是 L1 预测的核心输入。 表达你账号&ldquo;一条普通视频通常多少播放&rdquo;。
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4 text-sm">
        当前: <b>{initialValue ?? '—'}</b>
        {initialValue !== null && ' 播放/视频'} ({currentLabel})
      </div>

      <BaselineForm
        initialValue={initialValue}
        retroMedian={retroMedian}
        retroCount={retroCount}
      />
    </div>
  );
}
