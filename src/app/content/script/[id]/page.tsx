import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { ScriptResult, type Platform } from '@/components/content/script-result';
import { DistributionSection } from '@/components/content/distribution-section';

export default async function ScriptDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {draft.analysisId && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          ✓ 此脚本已用于分析:{' '}
          <Link href={`/content/preflight/${draft.analysisId}`} className="font-medium text-green-900 underline-offset-2 hover:underline">
            {draft.analysisId}
          </Link>
        </div>
      )}
      <ScriptResult
        platform={(draft.platform as Platform) ?? 'douyin'}
        result={draft.output as unknown as Record<string, unknown>}
        topic={draft.topic}
        niche={draft.niche}
        readonly
        draftId={draft.id}
        initialPicked={draft.picked as never}
      />
      <DistributionSection scriptId={draft.id} />
    </div>
  );
}
