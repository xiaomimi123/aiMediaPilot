import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { VideoTemplateConfigSchema } from '@/lib/video-template/model';
import { seedPresetsIfEmpty, newTemplateId, missingPresets } from '@/lib/video-template/store';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  await seedPresetsIfEmpty(user.id);
  const templates = await prisma.videoTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  /*
   * 一并回「你还缺哪些内置预设」。
   *
   * 播种只在 0 条模板时发生, 所以之后新增的预设永远到不了老用户手里。真实后果:
   * 对标参考片的「真人口播 · 文字叠加」一直在代码里却从没进过库, 十几轮出片全跑在
   * 带 B-roll 的模板上 —— 而参考片一帧 B-roll 都没有。界面上当时看不出任何异常。
   */
  return ok({ templates, missingPresets: missingPresets(templates.map((t) => t.name)) });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = VideoTemplateConfigSchema.safeParse(body);
  if (!parsed.success) return fail('模板配置不合法', 400);
  const cfg = parsed.data;

  // 新建时模板 id 还没确定, 无法校验这三个路径是否落在"自己的"素材目录下(终审发现4)——
  // 素材本来就只能通过 /assets 上传接口写入(先建模板拿到 id, 再上传), 所以新建请求体
  // 里这三个字段一律要求 null, 非 null 直接拒绝(不静默丢弃, 免得调用方误以为已生效)。
  if (cfg.bgmPath !== null || cfg.introPath !== null || cfg.outroPath !== null) {
    return fail('新建模板时素材路径必须为空, 请先创建后通过素材上传接口写入', 400);
  }

  const user = await getOrCreateDefaultUser();
  const now = new Date().toISOString();
  const created = await prisma.videoTemplate.create({
    data: {
      id: newTemplateId(),
      userId: user.id,
      isPreset: false,
      createdAt: now,
      updatedAt: now,
      name: cfg.name,
      description: cfg.description,
      deliveryMode: cfg.deliveryMode,
      visualStyle: cfg.visualStyle,
      palette: cfg.palette ?? undefined,
      voicePreset: cfg.voicePreset ?? undefined,
      scriptPrompt: cfg.scriptPrompt ?? undefined,
      // captionStyle 来自 model.ts 的 interface 类型, TS 结构化检查不会自动认定其满足
      // Prisma InputJsonValue 的隐式索引签名, 显式 cast 不改变实际写入内容(同 scripts/generate 路由)。
      captionStyle: (cfg.captionStyle ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      bgmPath: cfg.bgmPath,
      bgmVolume: cfg.bgmVolume,
      introPath: cfg.introPath,
      outroPath: cfg.outroPath,
      visualTone: cfg.visualTone,
      shotPaceSec: cfg.shotPaceSec,
      showChapterNav: cfg.showChapterNav,
      researchEnabled: cfg.researchEnabled,
      builderModel: cfg.builderModel,
      /*
       * 下面这几个此前**整组漏写**, 全落回数据库默认值。
       *
       * 真实后果: 「从预设新建」把「真人口播 · 文字叠加」加进库之后, 存成了
       * B-roll=true / 文字叠加=false —— 正好和预设相反。而这两个开关就是「像不像
       * 参考片」的全部区别: 参考片实测 49 帧全是真人实拍、一帧 B-roll 都没有。
       * 画幅同理, 竖屏预设进库会变成横屏。
       */
      aspect: cfg.aspect ?? undefined,
      talkingHeadLayout: cfg.talkingHeadLayout,
      textOverlayEnabled: cfg.textOverlayEnabled,
      personSide: cfg.personSide,
      brollEnabled: cfg.brollEnabled,
      pipPosition: cfg.pipPosition,
      pipScale: cfg.pipScale,
      pipMargin: cfg.pipMargin,
      defaultShotStyle: (cfg.defaultShotStyle ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    },
  });
  return ok({ template: created });
}
