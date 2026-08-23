import fs from 'fs/promises';
import path from 'path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { templateAssetDir, newTemplateId } from '@/lib/video-template/store';

/**
 * 复制模板。素材**复制文件本体**到新模板目录 —— 只复制引用会在删除原模板(连带清理
 * 素材目录)时让副本悬空(spec §4)。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const src = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!src || src.userId !== user.id) return fail('模板不存在', 404);

  const newId = newTemplateId();
  const newDir = templateAssetDir(newId);
  await fs.mkdir(newDir, { recursive: true });

  async function copyAsset(p: string | null): Promise<string | null> {
    if (!p) return null;
    const dest = path.join(newDir, path.basename(p));
    try {
      await fs.copyFile(p, dest);
      return dest;
    } catch {
      // 原文件已丢失: 副本就不带这项素材, 而不是让整个复制失败。
      return null;
    }
  }

  const now = new Date().toISOString();
  const created = await prisma.videoTemplate.create({
    data: {
      id: newId,
      userId: user.id,
      isPreset: false, // 副本不再是预设
      createdAt: now,
      updatedAt: now,
      name: `${src.name} 副本`,
      description: src.description,
      deliveryMode: src.deliveryMode,
      visualStyle: src.visualStyle,
      palette: src.palette ?? undefined,
      voicePreset: src.voicePreset ?? undefined,
      scriptPrompt: src.scriptPrompt ?? undefined,
      captionStyle: src.captionStyle ?? undefined,
      bgmPath: await copyAsset(src.bgmPath),
      bgmVolume: src.bgmVolume,
      introPath: await copyAsset(src.introPath),
      outroPath: await copyAsset(src.outroPath),
    },
  });
  return ok({ template: created });
}
