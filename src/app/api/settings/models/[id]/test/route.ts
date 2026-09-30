import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { listModels, saveTestResult } from '@/lib/llm/providers';
import { buildModel } from '@/lib/llm/provider';
import { runModelTest } from '@/lib/llm/model-test';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const c = (await listModels(prisma)).find((m) => m.id === params.id);
  if (!c) return fail('找不到这个模型', 404);
  const r = await runModelTest(buildModel(c));
  await saveTestResult(prisma, c.id, r);
  return ok(r);
}
