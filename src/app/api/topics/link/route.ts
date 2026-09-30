import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveLink } from '@/lib/benchmark/link';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { handlePaste } from '@/lib/benchmark/paste';
import { enqueueAnalysis } from '@/lib/benchmark/queue';
import { analyzeVideo, explainAnalyzeError } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const target = typeof text === 'string' ? await resolveLink(text).catch(() => null) : null;
  if (!target) return fail('这不是抖音视频或主页链接。在抖音里点「分享 → 复制链接」再粘贴。', 400);
  try {
    const r = await handlePaste(
      {
        store: createPrismaStore(prisma),
        client: createDouyinClient(),
        enqueue: (id) => enqueueAnalysis(id, async (vid) => analyzeVideo(await createAnalyzeDeps(prisma), vid)),
        now: () => new Date(),
      },
      target,
    );
    return ok(r);
  } catch (e) {
    return fail(explainAnalyzeError(e), 502);
  }
}
