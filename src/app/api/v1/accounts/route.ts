import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PLATFORM_META } from '@/lib/platform';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const accounts = await prisma.platformAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { notes: true } } },
  });

  return ok(
    accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      platformLabel: PLATFORM_META[a.platform].label,
      nickname: a.nickname,
      avatar: a.avatar,
      followerCount: a.followerCount,
      followingCount: a.followingCount,
      noteCount: a.noteCount,
      likeCount: a.likeCount,
      loginStatus: a.loginStatus,
      lastSyncAt: a.lastSyncAt,
      isActive: a.isActive,
      cachedNoteCount: a._count.notes,
    }))
  );
}
