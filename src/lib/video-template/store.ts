import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PRESET_TEMPLATES, type VideoTemplateConfig } from '@/lib/video-template/model';

/** 模板素材根目录 —— 与 VIDEO_PRODUCTION_ROOT 同一范式(见 video-productions/route.ts)。 */
export function templateAssetDir(templateId: string): string {
  return path.join(process.env.VIDEO_TEMPLATE_ROOT || './video-templates', templateId);
}

export function newTemplateId(): string {
  return randomUUID().slice(0, 12);
}

/**
 * 用户还缺哪些内置预设(按名字比)。
 *
 * **动因是一次真实事故。** 对标参考片的「真人口播 · 文字叠加」预设一直躺在代码里,
 * 但从没进过用户的数据库 —— `seedPresetsIfEmpty` 只在「0 条模板」时播种, 而用户
 * 早就有 4 条。后果: 十几轮出片全跑在带 B-roll 的模板上, 而参考片实测 49 帧全是
 * 真人实拍、一帧 B-roll 都没有 —— 方向从一开始就错了, 而界面上没有任何地方能看出
 * 「你缺一个模板」。
 *
 * 按**名字**比而不是按 id: 预设在库里是普通模板, 用户可以改可以删, id 对不上;
 * 名字是它和代码里那份定义之间唯一稳定的联系。
 */
export function missingPresets(existingNames: string[]): VideoTemplateConfig[] {
  const have = new Set(existingNames);
  return PRESET_TEMPLATES.filter((p) => !have.has(p.name));
}

/**
 * 首次进入模板页时播种内置预设(用户 0 条模板时才播)。幂等: count>0 直接返回,
 * 跑两次不会重复播种 —— 与四期迁移脚本"必须先有守卫再跑"是同一教训。
 *
 * **它不负责补新增的预设**: 那是 `missingPresets` + 模板页「从预设新建」的事。
 */
export async function seedPresetsIfEmpty(userId: string): Promise<void> {
  const count = await prisma.videoTemplate.count({ where: { userId } });
  if (count > 0) return;
  const now = new Date().toISOString();
  await prisma.videoTemplate.createMany({
    data: PRESET_TEMPLATES.map((preset) => ({
      id: newTemplateId(),
      userId,
      isPreset: true,
      createdAt: now,
      updatedAt: now,
      name: preset.name,
      description: preset.description,
      deliveryMode: preset.deliveryMode,
      visualStyle: preset.visualStyle,
      palette: preset.palette ?? undefined,
      voicePreset: preset.voicePreset ?? undefined,
      scriptPrompt: preset.scriptPrompt ?? undefined,
      // captionStyle 来自 model.ts 的 interface 类型, TS 结构化检查不会自动认定其满足
      // Prisma InputJsonValue 的隐式索引签名, 显式 cast 不改变实际写入内容(同 scripts/generate 路由)。
      captionStyle: (preset.captionStyle ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      bgmPath: preset.bgmPath,
      bgmVolume: preset.bgmVolume,
      introPath: preset.introPath,
      outroPath: preset.outroPath,
      visualTone: preset.visualTone,
      shotPaceSec: preset.shotPaceSec,
      showChapterNav: preset.showChapterNav,
      researchEnabled: preset.researchEnabled,
      builderModel: preset.builderModel,
    })),
  });
}
