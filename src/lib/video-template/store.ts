import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

/** 模板素材根目录 —— 与 VIDEO_PRODUCTION_ROOT 同一范式(见 video-productions/route.ts)。 */
export function templateAssetDir(templateId: string): string {
  return path.join(process.env.VIDEO_TEMPLATE_ROOT || './video-templates', templateId);
}

export function newTemplateId(): string {
  return randomUUID().slice(0, 12);
}

/**
 * 首次进入模板页时播种 3 个内置预设(用户 0 条模板时才播)。幂等: count>0 直接返回,
 * 跑两次不会重复播种 —— 与四期迁移脚本"必须先有守卫再跑"是同一教训。
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
    })),
  });
}
