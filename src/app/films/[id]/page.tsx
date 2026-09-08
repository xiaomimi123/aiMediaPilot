import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { FilmDetail } from '@/components/films/film-detail';
import { promises as fs } from 'fs';
import path from 'path';
import { probeVideoDimensions } from '@/lib/video/ffmpeg';
import { frameOfAspect } from '@/lib/video-template/aspect';
import type { SceneLayout } from '@/lib/video/scene-layout';
import type { FreezeReport } from '@/lib/video/freeze-check';

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
      // brollEnabled 要一起取: 关着时编辑台只能给「人物全屏」一种版面, 见 availableLayouts
      ? prisma.videoTemplate.findUnique({
          where: { id: vp.templateId },
          // aspect 要一起取: 没有出镜素材的链(图文口播/插画配音)画幅由模板定, 见下面 frame
          select: { name: true, brollEnabled: true, aspect: true },
        })
      : Promise.resolve(null),
  ]);

  const title = content?.title ?? '(内容已删除)';

  /*
   * 分镜从 direction.json 读 —— 那是导演阶段的产物, 预览跑完才有。
   * 读不到就不显示版面编辑: 没有分镜的时候「逐场景版面」无从谈起。
   */
  let scenes: { shotId: string; startMs: number; endMs: number; claim: string }[] = [];
  try {
    const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
    const d = JSON.parse(raw) as { shots?: { shotId: string; startMs: number; endMs: number; claim: string }[] };
    scenes = (d.shots ?? []).map((x) => ({
      shotId: String(x.shotId),
      startMs: Number(x.startMs),
      endMs: Number(x.endMs),
      claim: String(x.claim ?? ''),
    }));
  } catch { /* 还没跑到导演阶段 */ }

  /*
   * 画幅探真的 —— 版面框的位置全按它算, 猜错就画在错的地方。
   *
   * **原来只有真人出镜那条链是对的。** 有 source.mov 就探素材, 否则一律默认 1080x1920,
   * 可图文口播/插画配音两条链根本没有出镜素材, 它们的画幅是**模板 aspect 定的**
   * (worker 里就是 `frameOfAspect(template.aspect)`)。结果: 一条 1920x1080 的横屏
   * 成片, 编辑台画的是竖屏示意图 —— 界面和出片用的坐标对不上, 而这一页的说明文字
   * 还写着「和 ffmpeg 合成用的是同一套坐标」。真机上量出来才发现(画布 124x220)。
   *
   * 取值顺序: **已渲出来的成片文件 > 出镜素材 > 模板 aspect > 16:9 兜底**。
   *
   * 成片文件排第一, 因为对一条已经渲完的片子, 它自己就是画幅的最终事实。真机上撞到过:
   * 模板 aspect 现在写着 9:16, 而这条片子的 preview.mp4 是 1920x1080 —— 渲染之后模板
   * 被改过。信模板就会画一个和成片对不上的竖框, 而信文件永远对。
   */
  let frame = frameOfAspect(template?.aspect);
  for (const candidate of [vp.masterPath, vp.previewPath, vp.sourceVideoPath]) {
    if (!candidate) continue;
    try { frame = await probeVideoDimensions(candidate); break; } catch { /* 试下一个 */ }
  }

  const savedLayouts = Object.fromEntries(
    ((vp.sceneLayouts as { shotId?: string; layout?: string }[] | null) ?? [])
      .filter((x) => x.shotId && x.layout)
      .map((x) => [x.shotId as string, x.layout as SceneLayout]),
  );

  // 字幕轨用对齐后的六幕边界(真人出镜有 alignedActs), 没有就空着
  const captions = ((vp.alignedActs as { act?: string; startMs?: number; endMs?: number }[] | null) ?? [])
    .filter((a) => typeof a.startMs === 'number' && typeof a.endMs === 'number')
    .map((a) => ({ startMs: a.startMs as number, endMs: a.endMs as number, text: String(a.act ?? '') }));

  // 发布登记记在稿子上(Distribution.scriptDraftId), 所以这里要顺着内容找到稿子
  const published = content?.scriptDraftId
    ? await prisma.distribution.findFirst({
        where: { scriptDraftId: content.scriptDraftId, platform: 'douyin' },
        orderBy: { publishedAt: 'desc' },
        select: { url: true },
      })
    : null;

  return (
    /*
      不给 description: 「这条片子走到哪一步了，以及下一步等谁」和下面那张状态卡
      说的是同一件事, 而它占掉首屏 26px + 一份页头边距。状态卡说得更准(它带真实状态)。
    */
    <PageShell
      title={title}
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
          hasSource: Boolean(vp.sourceVideoPath),
          hasMaster: Boolean(vp.masterPath),
          templateName: template?.name ?? null,
          scriptDraftId: content?.scriptDraftId ?? null,
          publishedUrl: published?.url ?? null,
          scenes,
          captions,
          savedLayouts,
          brollEnabled: template?.brollEnabled ?? true,
          frame,
          // null 有确切含义: 这条片子出在静止关接线之前, 界面要说「没量过」而不是显示 0
          freezeReport: (vp.freezeReport as FreezeReport | null) ?? null,
          renderer: vp.renderer,
          productionNotice: vp.productionNotice,
        }}
      />
    </PageShell>
  );
}
