import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { ScriptResult } from '@/components/content/script-result';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate';

export default async function ScriptDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ScriptResult
        result={draft.output as unknown as ScriptGenerateResponse}
        topic={draft.topic}
        niche={draft.niche}
        readonly
        draftId={draft.id}
      />
    </div>
  );
}
