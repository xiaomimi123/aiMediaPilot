import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, Prisma } from '@prisma/client';
import { findActiveJob, startJob, withProjectLock, type JobRun } from '@/lib/jobs/runner';
import { JOB_KINDS } from '@/lib/jobs/registry';
import { versionedName } from '@/lib/files/storage';

/**
 * 上传写完临时文件后的收尾: 在项目锁内复查"没有转写在跑" → 分配版本号 → 改名 → 建文件行 → 启动转写。
 * 版本号在锁内分配, 两个标签页同时上传也不会撞同一个 raw.vN; 长时间上传期间若有人触发了转写, 这里会拒绝。
 */
export async function finalizeUpload(
  db: PrismaClient,
  opts: {
    projectId: string;
    tempPath: string;
    ext: string;
    meta: { originalName: string; sizeBytes: number; durationSec: number };
    run?: JobRun;
  },
): Promise<{ ok: true; fileId: string; jobId: string } | { ok: false; status: 409; message: string }> {
  return withProjectLock(`${opts.projectId}:transcribe`, async () => {
    if (await findActiveJob(db, opts.projectId, 'transcribe')) {
      await fs.unlink(opts.tempPath).catch(() => {});
      return { ok: false as const, status: 409 as const, message: '上一个视频还在转写，等它完成再传。' };
    }
    const last = await db.projectFile.findFirst({ where: { projectId: opts.projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;
    const dest = path.join(path.dirname(opts.tempPath), versionedName('raw_video', version, opts.ext));
    await fs.rename(opts.tempPath, dest);
    const file = await db.projectFile.create({
      data: { projectId: opts.projectId, kind: 'raw_video', path: dest, version, meta: opts.meta as Prisma.InputJsonValue },
    });
    const def = JOB_KINDS.transcribe;
    // 已在锁内, 直接 startJob(再调 startExclusiveJob 会等自己的锁)
    const { jobId } = await startJob(db, { projectId: opts.projectId, kind: 'transcribe', label: def.label, run: opts.run ?? def.run });
    return { ok: true as const, fileId: file.id, jobId };
  });
}
