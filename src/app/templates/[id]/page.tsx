import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { TemplateEditor } from '@/components/templates/template-editor';
import type { VideoTemplateConfig } from '@/lib/video-template/model';

export const dynamic = 'force-dynamic';

/**
 * 模板详情/编辑页。
 *
 * 二十期建了完整的模板 API(GET/PUT/DELETE、duplicate、productions、assets、
 * produce), 但前端只有一个只读列表 —— 卡片点不进去, 所有配置都只能靠改数据库。
 * 这一页把那批接口接上。
 *
 * 配置的默认值在这里补齐而不是在客户端: 库里的老模板可能缺字段(schema 后加的),
 * 而 PUT 走的是整份配置校验, 缺一个字段就是 400。在服务端补齐, 编辑器拿到的
 * 永远是一份完整配置。
 */
export default async function TemplateDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();

  const t = await prisma.videoTemplate.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) notFound();

  const productions = await prisma.videoProduction.findMany({
    where: { userId: user.id, templateId: id },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, status: true, createdAt: true },
  });

  const config: VideoTemplateConfig = {
    name: t.name,
    description: t.description ?? '',
    deliveryMode: t.deliveryMode as VideoTemplateConfig['deliveryMode'],
    visualStyle: (t.visualStyle ?? 'card') as VideoTemplateConfig['visualStyle'],
    palette: (t.palette as string[] | null) ?? null,
    voicePreset: (t.voicePreset as VideoTemplateConfig['voicePreset']) ?? null,
    scriptPrompt: (t.scriptPrompt as VideoTemplateConfig['scriptPrompt']) ?? null,
    // captionStyle 为 null 的语义是**不烧字幕**, 不是"没配过" —— 拿默认值兜底
    // 会把「这个模板不要字幕」悄悄改成「烧默认样式的字幕」。
    captionStyle: (t.captionStyle as VideoTemplateConfig['captionStyle']) ?? null,
    bgmPath: t.bgmPath ?? null,
    bgmVolume: t.bgmVolume ?? 0.2,
    introPath: t.introPath ?? null,
    outroPath: t.outroPath ?? null,
    visualTone: (t.visualTone ?? 'light') as VideoTemplateConfig['visualTone'],
    shotPaceSec: t.shotPaceSec ?? null,
    showChapterNav: t.showChapterNav ?? false,
    researchEnabled: t.researchEnabled ?? false,
    builderModel: (t.builderModel ?? 'deepseek-chat') as VideoTemplateConfig['builderModel'],
    talkingHeadLayout: (t.talkingHeadLayout ?? 'cutaway') as VideoTemplateConfig['talkingHeadLayout'],
    pipPosition: (t.pipPosition ?? 'br') as VideoTemplateConfig['pipPosition'],
    pipScale: t.pipScale ?? 0.25,
    pipMargin: t.pipMargin ?? 40,
    textOverlayEnabled: t.textOverlayEnabled ?? false,
    personSide: (t.personSide ?? 'right') as VideoTemplateConfig['personSide'],
    brollEnabled: t.brollEnabled ?? true,
  };

  return (
    <PageShell
      title={t.name}
      description="改完点保存。这套配置决定用它出片时的画面结构、字幕和音频。"
      actions={
        <div className="flex items-center gap-3">
          {/* 试做台(HTML 分镜实时预览)随旧渲染层一起下线(三十期 Task 3)——
              Remotion 产物没有等价的轻量试做机制, 改效果直接走正式预览/正式渲染。 */}
          <Link
            href="/templates"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            回模板列表
          </Link>
        </div>
      }
    >
      <TemplateEditor
        templateId={id}
        initial={config}
        isPreset={t.isPreset ?? false}
        productions={productions.map((p) => ({
          id: p.id,
          status: p.status,
          createdAt: p.createdAt.slice(0, 10),
        }))}
      />
    </PageShell>
  );
}
