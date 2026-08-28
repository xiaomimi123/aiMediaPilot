import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const user = await getOrCreateDefaultUser();
  const [templates, doneFilms] = await Promise.all([
    prisma.videoTemplate.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
    prisma.videoProduction.count({ where: { userId: user.id, status: 'done' } }),
  ]);

  return (
    <PageShell title="模板" description="决定成片的画面结构、字幕样式和转场，出片时套用。">
      {doneFilms === 0 && templates.length > 0 ? (
        <p className="mb-4 rounded-md border border-border bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
          {templates.length} 个模板都还没产出过成片。模板本身没问题，卡在出片链路。
          启动 worker 之后建议先用一个模板跑通一条，再改其他的。
        </p>
      ) : null}

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有模板。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card className="p-4">
                <p className="font-medium">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.deliveryMode} · {new Date(t.createdAt).toISOString().slice(0, 10)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
