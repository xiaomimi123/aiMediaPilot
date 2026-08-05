import { Suspense } from 'react';
import { UploadForm } from '@/components/content/upload-form';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export default async function NewAnalysisPage() {
  const user = await getOrCreateDefaultUser();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { baselinePlays: true },
  });
  const hasBaseline = fresh?.baselinePlays != null && fresh.baselinePlays > 0n;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">新分析</h1>
      <Suspense fallback={<div className="text-sm text-[var(--muted)]">加载中…</div>}>
        <UploadForm needsBaselineOnboarding={!hasBaseline} />
      </Suspense>
    </div>
  );
}
