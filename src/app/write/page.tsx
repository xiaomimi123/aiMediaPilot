import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { NewScript } from '@/components/script/new-script';

export const dynamic = 'force-dynamic';

/**
 * 新建稿子(v5)。
 *
 * 这是「系统给起点」的那一头。起点有两种粒度, 由使用者当场选:
 * 骨架(台词自己写)/ 完整初稿(在上面改)。默认骨架 —— 完整初稿最容易把人带向
 * AI 的表达, 眼前摆着通顺的一段话, 人会本能地改几个词就交差。
 */
export default async function WritePage() {
  const user = await getOrCreateDefaultUser();
  const inspirations = await prisma.cockpitInspiration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, text: true },
  });

  return (
    <PageShell title="写稿" description="挑个选题，选个起点粒度，剩下的你自己写。">
      <NewScript inspirations={inspirations} />
    </PageShell>
  );
}
