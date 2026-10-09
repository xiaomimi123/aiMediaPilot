import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { addSample, listSamples } from '@/lib/voice/samples';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok(await listSamples(prisma));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; text?: string; source?: string };
  try {
    // 页面只能加手动样本或作品转写; own_script 由「我自己写了一篇」建作品时存
    return ok(await addSample(prisma, { title: String(b.title ?? ''), text: String(b.text ?? ''), source: b.source === 'transcript' ? 'transcript' : 'manual' }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
}
