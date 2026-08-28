import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { TemplateStudio } from '@/components/templates/studio';

export const dynamic = 'force-dynamic';

/**
 * 模板试做台。
 *
 * 模板页原本只能改配置项, 改完不知道效果 —— 要看效果得去发起一次完整出片, 三分多钟。
 * 这一页把管线截到「构建者出 HTML」为止, 预览直接在浏览器里放。
 */
export default async function TemplateStudioPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();

  const t = await prisma.videoTemplate.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) notFound();

  return (
    <PageShell
      title={`试做 · ${t.name}`}
      description="文案 → 切分 → 画面 → 预览。改完就能看，不用等完整渲染。"
      actions={
        <Link
          href={`/templates/${id}`}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          回模板配置
        </Link>
      }
    >
      <TemplateStudio
        templateId={id}
        templateName={t.name}
        builderModel={t.builderModel ?? 'deepseek-chat'}
        visualStyle={t.visualStyle ?? 'card'}
        visualTone={t.visualTone ?? 'dark'}
      />
    </PageShell>
  );
}
