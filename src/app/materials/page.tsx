import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { materialGaps } from '@/lib/materials/model';
import { MaterialLibrary } from '@/components/materials/material-library';

export const dynamic = 'force-dynamic';

export default async function MaterialsPage() {
  const user = await getOrCreateDefaultUser();
  const materials = await prisma.material.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  const rows = materials.map((m) => ({
    id: m.id,
    kind: m.kind,
    content: m.content,
    source: m.source,
    tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
    createdAt: m.createdAt.toISOString().slice(0, 10),
  }));

  return (
    <PageShell
      title="素材库"
      description="读到、想到、经历过的具体材料。写稿时按幕自动检索——不够用，AI 就会开始编。"
    >
      <MaterialLibrary initial={rows} gaps={materialGaps(rows)} />
    </PageShell>
  );
}
