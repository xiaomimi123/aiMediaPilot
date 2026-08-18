import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { isSixActScript, type ScriptAct } from '@/lib/script/six-act';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';

/**
 * 触发一次成片生成 (十八期 T8) — 六幕脚本 → SRT → 落一条 VideoProduction
 * → 入队 preview 模式渲染任务, 真正的 Director/Builder/渲染流水线由
 * videoProductionQueue 的 worker (T7) 消费。
 */
export async function POST(req: Request) {
  const user = await getOrCreateDefaultUser();
  const { contentId } = await req.json();
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  if (!content || content.userId !== user.id) return fail('内容不存在', 404);

  const script = content.script as { acts?: unknown };
  if (!isSixActScript({ acts: script.acts, four_dims: (content.script as any).four_dims })) {
    return fail('需要先生成六幕脚本', 400);
  }

  const srt = synthesizeSrtFromSixActScript(script.acts as ScriptAct[]);
  const id = randomUUID().slice(0, 12);
  const productionRoot = path.join(process.env.VIDEO_PRODUCTION_ROOT || './video-productions', id);
  await fs.mkdir(productionRoot, { recursive: true });

  const vp = await prisma.videoProduction.create({
    data: {
      id,
      userId: user.id,
      contentId,
      srt,
      productionRoot,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  await videoProductionQueue.add('produce', { videoProductionId: id, mode: 'preview' });
  return ok({ id: vp.id, status: vp.status });
}
