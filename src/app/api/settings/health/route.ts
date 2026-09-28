import fs from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { runHealthChecks, realExec } from '@/lib/health/checks';
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';

export const dynamic = 'force-dynamic';

export async function GET() {
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
  });
  return ok(items);
}
