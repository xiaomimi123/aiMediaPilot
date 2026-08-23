import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { VideoTemplateConfigSchema } from '@/lib/video-template/model';
import { seedPresetsIfEmpty, newTemplateId } from '@/lib/video-template/store';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  await seedPresetsIfEmpty(user.id);
  const templates = await prisma.videoTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ templates });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = VideoTemplateConfigSchema.safeParse(body);
  if (!parsed.success) return fail('模板配置不合法', 400);
  const cfg = parsed.data;

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
    },
  });
  return ok({ template: created });
}
