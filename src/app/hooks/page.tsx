import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { hookStructureHints } from '@/lib/hooks/model';
import { HookLibrary } from '@/components/hooks/hook-library';

export const dynamic = 'force-dynamic';

export default async function HooksPage() {
  const user = await getOrCreateDefaultUser();
  const hooks = await prisma.hook.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, text: true, pattern: true, origin: true, scriptId: true },
  });

  return (
    <PageShell title="钩子库" description="前 3 秒决定完播。这里收你写过和拆过的开场。">
      <HookLibrary initial={hooks} hints={hookStructureHints(hooks)} />
    </PageShell>
  );
}
