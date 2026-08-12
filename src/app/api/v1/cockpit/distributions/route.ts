import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { COCKPIT_TO_DISTRIBUTION_PLATFORM } from '@/lib/cockpit/distribution-platform';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  if (!platform) return fail('platform 必填', 400);

  const distributionPlatform = COCKPIT_TO_DISTRIBUTION_PLATFORM[platform];
  if (!distributionPlatform) return fail('未知 platform', 400);

  try {
    const user = await getOrCreateDefaultUser();
    const rows = await prisma.distribution.findMany({
      where: { platform: distributionPlatform, scriptDraft: { userId: user.id } },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        platform: true,
        url: true,
        publishedAt: true,
        scriptDraft: { select: { topic: true } },
      },
    });
    const items = rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      url: row.url,
      publishedAt: row.publishedAt.toISOString(),
      sourceTopic: row.scriptDraft.topic,
    }));
    return ok({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET cockpit/distributions]', e);
    return fail(`加载失败: ${msg}`, 500);
  }
}
