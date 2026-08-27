import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { TeardownView } from '@/components/teardowns/teardown-view';

export const dynamic = 'force-dynamic';

export default async function TeardownsPage() {
  const user = await getOrCreateDefaultUser();
  const teardowns = await prisma.teardown.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, title: true, author: true, url: true,
      status: true, result: true, errorMessage: true, createdAt: true,
    },
  });

  return (
    <PageShell
      title="拆解"
      description="把别人的口播稿拆成结构、钩子和可照做的动作，然后收进自己的库。"
    >
      <TeardownView
        initial={teardowns.map((t) => ({
          id: t.id,
          title: t.title,
          author: t.author,
          url: t.url,
          status: t.status,
          result: t.result as Record<string, unknown> | null,
          errorMessage: t.errorMessage,
          createdAt: t.createdAt.toISOString().slice(0, 10),
        }))}
      />
    </PageShell>
  );
}
