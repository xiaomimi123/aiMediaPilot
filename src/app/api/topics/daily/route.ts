import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { listDaily } from '@/lib/topics/daily';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok(await listDaily(prisma, new Date()));
}
