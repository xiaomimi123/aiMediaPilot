import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createModel, ensureMigrated, listModels, ModelInputSchema, PRESETS, toModelView } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureMigrated(prisma, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY });
  return ok({ models: (await listModels(prisma)).map(toModelView), presets: PRESETS });
}

export async function POST(req: Request) {
  const p = ModelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fail(p.error.issues[0]?.message ?? '填写不完整', 400);
  if (p.data.kind === 'anthropic' && !p.data.apiKey) return fail('Claude 需要填 key', 400);
  return ok(toModelView(await createModel(prisma, p.data)));
}
