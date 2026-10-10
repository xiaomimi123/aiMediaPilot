import type { Prisma, PrismaClient } from '@prisma/client';
import { ScriptSchema, type Script } from '@/lib/script/model';
import { addSample } from '@/lib/voice/samples';

type Db = Pick<PrismaClient, 'personaProfile' | 'project' | 'voiceSample'>;

/** 建项目并存下当时的人设快照(事后改人设不影响已有项目) */
export async function createProject(db: Pick<PrismaClient, 'personaProfile' | 'project'>, title?: string, opts: { script?: Script; targetSec?: number } = {}) {
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  return db.project.create({
    data: {
      title: title?.trim() || '未命名项目',
      // 经 JSON 往返: 行里的 updatedAt 是 Date, Json 列只收纯 JSON 值
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
      ...(opts.script ? { script: opts.script as unknown as Prisma.InputJsonValue } : {}),
      ...(opts.targetSec ? { targetSec: opts.targetSec } : {}),
    },
  });
}

/** 「我自己写了一篇」: 用润色版或原文建作品, 原文存为说话样本 */
export async function createFromOwnScript(db: Db, o: { title?: string; script: Script; targetSec: number; originalText: string }) {
  const script = ScriptSchema.safeParse(o.script);
  if (!script.success) throw new Error('稿子格式不对：要 6 段');
  if (script.data.segments.some((s) => !s.text.trim())) throw new Error('稿子太短，分不出 6 段：多写几句再建作品');
  const title = o.title?.trim() || o.originalText.trim().split(/[。！？!?\n，,]/)[0].slice(0, 20);
  const p = await createProject(db, title, { script: script.data, targetSec: o.targetSec });
  await addSample(db, { title, text: o.originalText, source: 'own_script' });
  return p;
}
