import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { VideoTemplateConfigSchema } from '@/lib/video-template/model';
import { templateAssetDir } from '@/lib/video-template/store';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);
  return ok({ template: t });
}

/**
 * bgmPath/introPath/outroPath 会被直接拼进 ffmpeg -i 参数(见 mixBgm/attachIntroOutro),
 * 完全绕开 /assets 上传路由的 MIME 白名单/大小上限/safeExt 防护——非 null 时必须落在
 * 该模板自己的素材目录下。用路径分隔符做边界判断(而非裸 startsWith), 避免 "t1" 前缀
 * 误配到 "t12" 这类兄弟目录。
 */
function isWithinTemplateAssetDir(templateId: string, p: string): boolean {
  const dir = path.resolve(templateAssetDir(templateId));
  const resolved = path.resolve(p);
  return resolved === dir || resolved.startsWith(dir + path.sep);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = VideoTemplateConfigSchema.safeParse(body);
  if (!parsed.success) return fail('模板配置不合法', 400);
  const cfg = parsed.data;

  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  for (const p of [cfg.bgmPath, cfg.introPath, cfg.outroPath]) {
    if (p !== null && !isWithinTemplateAssetDir(params.id, p)) {
      return fail('素材路径必须落在本模板的素材目录下, 请通过素材上传接口获取', 400);
    }
  }

  // isPreset 只是 UI 徽标, 预设模板同样可改(用户明确要求"对某一个模板不断调整")。
  const updated = await prisma.videoTemplate.update({
    where: { id: params.id },
    data: {
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
      updatedAt: new Date().toISOString(),
    },
  });
  return ok({ template: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  await prisma.videoTemplate.delete({ where: { id: params.id } });
  // 素材目录随模板一起清理; 失败不阻断删除(模板记录已经没了, 留下孤儿文件不影响正确性)。
  await fs.rm(templateAssetDir(params.id), { recursive: true, force: true }).catch(() => {});
  return ok({ deleted: true });
}
