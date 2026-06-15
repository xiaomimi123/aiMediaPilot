import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { RetroSyncTable } from '@/components/content/retro-sync-table';

export default async function RetroSyncPage() {
  const user = await getOrCreateDefaultUser();
  const unmatched = await prisma.contentAnalysis.findMany({
    where: {
      userId: user.id,
      status: 'COMPLETED',
      OR: [{ douyinAwemeId: null }, { retroStatus: null }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, videoFilename: true, draftTitle: true, createdAt: true },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">抖音同步</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把发布的抖音视频对应到 MediaPilot 分析, 立即跑复盘。
        </p>
      </div>
      <RetroSyncTable
        unmatched={unmatched.map((a) => ({
          id: a.id,
          videoFilename: a.videoFilename,
          draftTitle: a.draftTitle,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
