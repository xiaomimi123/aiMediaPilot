import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { runHealthChecks, realExec } from '@/lib/health/checks';
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';
import { resolveClaudeBin } from '@/lib/film-session/args';
import { ensureMigrated, getActiveConfig } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureMigrated(prisma, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY });
  const c = await getActiveConfig(prisma);
  const items = await runHealthChecks({
    exec: realExec,
    exists: (p) => fs.access(p).then(() => true, () => false),
    dbPing: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    env: process.env,
    cwd: process.cwd(),
    collect: await readCollectStatus(),
    scan: await readScanStatus(),
    claudeBin: resolveClaudeBin(process.env, fsSync.existsSync, os.homedir()),
    model: c ? { label: `${c.name}（${c.model}）`, grade: c.lastTest?.grade ?? null } : null,
  });
  return ok(items);
}
