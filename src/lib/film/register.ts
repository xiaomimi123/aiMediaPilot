import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, Prisma } from '@prisma/client';
import { projectDir } from '@/lib/files/storage';
import { ShotsFileSchema } from './shots';
import { isFilmOrientation } from './orientation';

const ADVANCE_FROM = ['draft', 'scripted', 'recorded'];

/** 登记成片: 移入项目目录 → 建 final_mp4 行(带素材使用表) → 推进阶段 → 对话里发通知 */
export async function registerFilm(db: PrismaClient, filmDir: string, summary: string): Promise<{ fileId: string; version: number }> {
  const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8')) as { projectId: string; version: number; orientation?: unknown };
  const mp4 = path.join(filmDir, 'out', 'final.mp4');
  const stat = await fs.stat(mp4).catch(() => null);
  if (!stat || stat.size === 0) throw new Error(`没找到成片：${mp4}（先运行 mp film render）`);
  const shots = ShotsFileSchema.parse(JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8')));
  const usage = shots.shots
    .filter((s) => s.material)
    .map((s) => ({
      materialId: s.material!.id,
      atSec: s.fromSec,
      durSec: Math.round((s.toSec - s.fromSec) * 100) / 100,
      ...(s.material!.clipFromSec !== undefined ? { clipFromSec: s.material!.clipFromSec } : {}),
      ...(s.material!.clipToSec !== undefined ? { clipToSec: s.material!.clipToSec } : {}),
      ...(s.material!.speed !== undefined ? { speed: s.material!.speed } : {}),
    }));

  const dest = path.join(projectDir(data.projectId), `final.v${data.version}.mp4`);
  // 同一版本只能登记一次: 重复登记会用新文件覆盖旧成片, 违背"旧版保留"
  const registered = await db.projectFile.findMany({ where: { projectId: data.projectId, kind: 'final_mp4' } });
  const clash = registered.some((f) => Number((f.meta as { filmVersion?: unknown })?.filmVersion) === data.version);
  if (clash || (await fs.stat(dest).catch(() => null))) {
    throw new Error(`成片 v${data.version} 已经登记过了（旧版不覆盖）。要改就 mp film new 出一个新版本。`);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(mp4, dest);
  } catch {
    await fs.copyFile(mp4, dest);
    await fs.unlink(mp4).catch(() => {});
  }
  const file = await db.projectFile.create({
    data: {
      projectId: data.projectId,
      kind: 'final_mp4',
      path: dest,
      version: data.version,
      meta: { filmVersion: data.version, sourceDir: filmDir, summary, usage, orientation: isFilmOrientation(data.orientation) ? data.orientation : 'portrait' } as Prisma.InputJsonValue,
    },
  });
  const p = await db.project.findUniqueOrThrow({ where: { id: data.projectId } });
  if (ADVANCE_FROM.includes(p.stage)) await db.project.update({ where: { id: data.projectId }, data: { stage: 'final' } });
  await db.chatMessage.create({
    data: { projectId: data.projectId, role: 'system', content: `成片 v${data.version} 已生成：${summary}`, toolName: 'job:film', toolResult: { ok: true } },
  });
  return { fileId: file.id, version: data.version };
}
