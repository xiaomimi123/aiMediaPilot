import type { Prisma, PrismaClient } from '@prisma/client';
import { AnalysisSchema, type Analysis } from './analyze';

export interface Reference {
  author: string;
  ratio: number | null;
  transcript: string;
  analysis: Analysis | null;
}

export async function loadReference(db: PrismaClient, benchmarkVideoId: string | null): Promise<Reference | null> {
  if (!benchmarkVideoId) return null;
  const v = await db.benchmarkVideo.findUnique({ where: { id: benchmarkVideoId }, include: { account: true } });
  if (!v) return null;
  const a = AnalysisSchema.safeParse(v.analysis);
  return { author: v.account.nickname, ratio: v.ratio, transcript: v.transcript ?? '', analysis: a.success ? a.data : null };
}

export function formatReference(r: Reference): string {
  const lines = [`博主：${r.author}${r.ratio ? `（点赞是他平时的 ${r.ratio} 倍）` : ''}`];
  if (r.analysis) {
    lines.push(`选题：${r.analysis.topic}`, `开头钩子（${r.analysis.hook.type}）：${r.analysis.hook.quote}`, `标题写法：${r.analysis.titlePattern}`, `建议角度：${r.analysis.myAngle}`);
  }
  if (r.transcript) lines.push(`【逐字稿】\n${r.transcript}`);
  return lines.join('\n');
}

/** 从对标作品建项目: 标题用拆解的选题(没拆解用文案前 30 字), 记下参考作品, 作品标为已建项目 */
export async function createProjectFromVideo(db: PrismaClient, videoId: string, title?: string): Promise<{ id: string }> {
  const v = await db.benchmarkVideo.findUniqueOrThrow({ where: { id: videoId } });
  const a = AnalysisSchema.safeParse(v.analysis);
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const p = await db.project.create({
    data: {
      title: title?.trim() || (a.success ? a.data.topic : v.desc.replace(/#\S+/g, '').trim().slice(0, 30)) || '未命名项目',
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
      benchmarkVideoId: v.id,
    },
  });
  await db.benchmarkVideo.update({ where: { id: v.id }, data: { status: 'adopted' } });
  return { id: p.id };
}
