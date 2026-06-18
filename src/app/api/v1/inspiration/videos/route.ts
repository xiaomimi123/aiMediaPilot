import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { parseDouyinVideoUrl } from '@/lib/inspiration/url-parser';
import { resolveDouyinShortLink } from '@/lib/inspiration/short-link-resolver';
import { fetchPublicVideo } from '@/lib/inspiration/public-video-adapter';

function bigOrNull(n: number | undefined): bigint | null {
  if (n === undefined || n === null || !Number.isFinite(n)) return null;
  if (n < 0) return null;
  return BigInt(Math.round(n));
}

interface ManualMetadata {
  title?: string;
  authorName?: string;
  playCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  durationSec?: number;
}

interface AddBody {
  url?: unknown;
  userNote?: unknown;
  manualMetadata?: ManualMetadata; // optional, used when auto-fetch yields nothing
}

export async function POST(req: Request) {
  let body: AddBody;
  try {
    body = (await req.json()) as AddBody;
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const userNote = typeof body.userNote === 'string' ? body.userNote.trim() : '';

  const parsed = parseDouyinVideoUrl(url);
  if (!parsed) return fail('无法解析抖音视频 URL', 400);

  // 短链 → 服务端解析重定向, 拿真 aweme_id
  let awemeId = parsed.awemeId;
  let canonicalUrl = parsed.canonicalUrl;
  if (parsed.isShortLink) {
    const resolved = await resolveDouyinShortLink(parsed.canonicalUrl);
    if (!resolved) {
      return fail('短链解析失败, 请尝试粘完整 www.douyin.com/video/xxx URL', 400);
    }
    awemeId = resolved.awemeId;
    canonicalUrl = `https://www.douyin.com/video/${resolved.awemeId}`;
  }

  const user = await getOrCreateDefaultUser();

  // Already saved?
  const existing = await prisma.inspirationVideo.findFirst({
    where: { userId: user.id, platform: 'douyin', awemeId },
    select: { id: true },
  });
  if (existing) return fail('该视频已在灵感库中', 409);

  // Try auto-fetch first
  let fetched: Awaited<ReturnType<typeof fetchPublicVideo>> = null;
  let fetchError: string | null = null;
  try {
    fetched = await fetchPublicVideo(awemeId);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
    console.error('[POST inspiration/videos] auto fetch failed', e);
  }

  // Determine final values: prefer fetched, fall back to manual
  const m = body.manualMetadata ?? {};
  const title = fetched?.title || (m.title ?? '').trim();
  if (!title) {
    return fail(
      fetchError
        ? `自动抓取失败: ${fetchError}. 请提供 manualMetadata.title 等手动字段`
        : '自动抓取无数据, 请提供 manualMetadata.title 等手动字段',
      422,
    );
  }

  const createTimeSec = fetched?.createTime;
  const publishedAt = createTimeSec ? new Date(createTimeSec * 1000) : null;

  try {
    const created = await prisma.inspirationVideo.create({
      data: {
        userId: user.id,
        platform: 'douyin',
        awemeId,
        videoUrl: canonicalUrl,
        authorName: fetched?.authorName ?? m.authorName ?? null,
        title,
        playCount: bigOrNull(fetched?.playCount ?? m.playCount),
        likeCount: bigOrNull(fetched?.diggCount ?? m.likeCount),
        commentCount: bigOrNull(fetched?.commentCount ?? m.commentCount),
        shareCount: bigOrNull(fetched?.shareCount ?? m.shareCount),
        collectCount: bigOrNull(fetched?.collectCount),
        duration: fetched?.durationMs
          ? Math.round(fetched.durationMs / 1000)
          : m.durationSec ?? null,
        publishedAt,
        thumbnailUrl: fetched?.thumbnailUrl ?? null,
        userNote: userNote || null,
        rawData: fetched ? (fetched as unknown as object) : undefined,
      },
      select: { id: true },
    });
    return ok({ id: created.id, source: fetched ? 'auto' : 'manual' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST inspiration/videos] db write failed', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.inspirationVideo.findMany({
    where: { userId: user.id },
    orderBy: { fetchedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      platform: true,
      awemeId: true,
      videoUrl: true,
      authorName: true,
      title: true,
      playCount: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      duration: true,
      publishedAt: true,
      thumbnailUrl: true,
      userNote: true,
      fetchedAt: true,
    },
  });
  return ok({
    items: items.map((i) => ({
      ...i,
      playCount: i.playCount?.toString() ?? null,
      likeCount: i.likeCount?.toString() ?? null,
      commentCount: i.commentCount?.toString() ?? null,
      shareCount: i.shareCount?.toString() ?? null,
      publishedAt: i.publishedAt?.toISOString() ?? null,
      fetchedAt: i.fetchedAt.toISOString(),
    })),
  });
}
