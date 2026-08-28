import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { FilmDetail } from '@/components/films/film-detail';

export const dynamic = 'force-dynamic';

/**
 * 成片详情。
 *
 * 「确认导出」的入口在这里 —— 它在 v5 重建里连同旧的内容详情页一起被删了,
 * 而 approve 接口和 worker 的 master→packaging→done 分支都还在, 于是所有任务
 * 跑到 preview_ready 就永远停住。
 */
export default async function FilmDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();

  const vp = await prisma.videoProduction.findUnique({ where: { id } });
  if (!vp || vp.userId !== user.id) notFound();

  const [content, template] = await Promise.all([
    prisma.cockpitContent.findUnique({
      where: { id: vp.contentId },
      select: { title: true, scriptDraftId: true },
    }),
    vp.templateId
      ? prisma.videoTemplate.findUnique({ where: { id: vp.templateId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const title = content?.title ?? '(内容已删除)';

  // 发布登记记在稿子上(Distribution.scriptDraftId), 所以这里要顺着内容找到稿子
  const published = content?.scriptDraftId
    ? await prisma.distribution.findFirst({
        where: { scriptDraftId: content.scriptDraftId, platform: 'douyin' },
        orderBy: { publishedAt: 'desc' },
        select: { url: true },
      })
    : null;

  return (
    <PageShell
      title={title}
      description="这条片子走到哪一步了，以及下一步等谁。"
      actions={
        <Link
          href="/films"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          回成片列表
        </Link>
      }
    >
      <FilmDetail
        initial={{
          id: vp.id,
          title,
          mode: vp.mode,
          status: vp.status,
          createdAt: vp.createdAt.slice(0, 10),
          errorMessage: vp.errorMessage,
          hasPreview: Boolean(vp.previewPath),
          hasMaster: Boolean(vp.masterPath),
          templateName: template?.name ?? null,
          scriptDraftId: content?.scriptDraftId ?? null,
          publishedUrl: published?.url ?? null,
        }}
      />
    </PageShell>
  );
}
