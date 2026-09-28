import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveLink } from '@/lib/benchmark/link';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { applyAccountWorks } from '@/lib/benchmark/scan';
import { enqueueAnalysis } from '@/lib/benchmark/queue';
import { analyzeVideo, explainAnalyzeError } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const target = typeof text === 'string' ? await resolveLink(text).catch(() => null) : null;
  if (!target) return fail('这不是抖音视频或主页链接。在抖音里点「分享 → 复制链接」再粘贴。', 400);
  const client = createDouyinClient();
  const store = createPrismaStore(prisma);
  try {
    if (target.kind === 'user') {
      const { profile, works } = await client.fetchAccount(target.secUid);
      const acc = await store.upsertAccount(profile, { status: 'following', source: 'manual' });
      if (acc.status !== 'following') await store.updateAccount(acc.id, { status: 'following' });
      await applyAccountWorks(store, { ...acc, status: 'following' }, profile, works, new Date());
      return ok({ kind: 'account' as const, accountId: acc.id });
    }
    const w = await client.fetchDetail(target.awemeId);
    const acc = await store.upsertAccount(
      { secUid: w.authorSecUid, nickname: w.authorName, douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 },
      { status: 'candidate', source: 'link' },
    );
    const v = await store.upsertVideo(acc.id, w, new Date());
    if (enqueueAnalysis(v.id, async (id) => analyzeVideo(await createAnalyzeDeps(prisma), id))) {
      await store.updateVideo(v.id, { analysisStatus: 'running', analysisError: null });
    }
    return ok({ kind: 'video' as const, videoId: v.id });
  } catch (e) {
    return fail(explainAnalyzeError(e), 502);
  }
}
