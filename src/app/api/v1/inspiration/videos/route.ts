import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { detectInspirationSource, type InspirationPlatform } from '@/lib/inspiration/url-parser';
import { resolveDouyinShortLink, resolveXhsShortLink } from '@/lib/inspiration/short-link-resolver';
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
  publishedAtISO?: string;
}

interface AddBody {
  url?: unknown;
  userNote?: unknown;
  manualMetadata?: ManualMetadata;
}

export async function POST(req: Request) {
  let body: AddBody;
  try {
    body = (await req.json()) as AddBody;
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const userNote = typeof body.userNote === 'string' ? body.userNote.trim() : '';

  const source = detectInspirationSource(rawUrl);
  if (!source) return fail('无法识别 URL — 支持抖音 / 小红书 / 公众号链接或分享文本', 400);

  let externalId = source.externalId;
  let canonicalUrl = source.canonicalUrl;
  const platform: InspirationPlatform = source.platform;

  // Douyin 短链 → 服务端解析重定向, 拿真 aweme_id
  if (platform === 'douyin' && source.isShortLink) {
    const resolved = await resolveDouyinShortLink(source.canonicalUrl);
    if (!resolved) {
      return fail('短链解析失败, 请尝试粘完整 www.douyin.com/video/xxx URL', 400);
    }
    externalId = resolved.awemeId;
    canonicalUrl = `https://www.douyin.com/video/${resolved.awemeId}`;
  }

  // XHS 短链 → 同样先 resolve 拿真 noteId, 避免 xhslink 与 explore/<hex> 被存 2 行
  if (platform === 'xiaohongshu' && source.isShortLink) {
    const resolved = await resolveXhsShortLink(source.canonicalUrl);
    if (!resolved) {
      return fail('小红书短链解析失败, 请尝试粘完整 xiaohongshu.com/explore/xxx URL', 400);
    }
    externalId = resolved.noteId;
    canonicalUrl = `https://www.xiaohongshu.com/explore/${resolved.noteId}`;
  }

  const user = await getOrCreateDefaultUser();

  // Already saved?
  const existing = await prisma.inspirationVideo.findFirst({
    where: { userId: user.id, platform, awemeId: externalId },
    select: { id: true },
  });
  if (existing) return fail('该视频已在灵感库中', 409);

  // 只有 douyin 有 crawler
  let fetched: Awaited<ReturnType<typeof fetchPublicVideo>> = null;
  let fetchError: string | null = null;
  if (platform === 'douyin' && externalId) {
    try {
      fetched = await fetchPublicVideo(externalId);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
      console.error('[POST inspiration/videos] auto fetch failed', e);
    }
  }

  // Manual fallback
  const m = body.manualMetadata ?? {};
  const title = fetched?.title || (m.title ?? '').trim();
  if (!title) {
    const platformLabel =
      platform === 'douyin' ? '抖音' : platform === 'xiaohongshu' ? '小红书' : '公众号';
    if (platform === 'douyin') {
      return fail(
        fetchError
          ? `自动抓取失败: ${fetchError}. 请提供 manualMetadata.title 等手动字段`
          : '自动抓取无数据, 请提供 manualMetadata.title 等手动字段',
        422,
      );
    }
    return fail(`${platformLabel} 暂无自动抓取, 请填 manualMetadata.title (标题必填)`, 422);
  }

  const publishedAt =
    fetched?.createTime
      ? new Date(fetched.createTime * 1000)
      : m.publishedAtISO
        ? new Date(m.publishedAtISO)
        : null;

  try {
    const created = await prisma.inspirationVideo.create({
      data: {
        userId: user.id,
        platform,
        awemeId: externalId,
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
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        thumbnailUrl: fetched?.thumbnailUrl ?? null,
        userNote: userNote || null,
        rawData: fetched ? (fetched as unknown as object) : undefined,
      },
      select: { id: true },
    });
    return ok({ id: created.id, source: fetched ? 'auto' : 'manual', platform });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST inspiration/videos] db write failed', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const platformFilter = url.searchParams.get('platform');
  const validPlatform =
    platformFilter === 'douyin' || platformFilter === 'xiaohongshu' || platformFilter === 'gongzhonghao'
      ? platformFilter
      : null;

  const user = await getOrCreateDefaultUser();
  const items = await prisma.inspirationVideo.findMany({
    where: { userId: user.id, ...(validPlatform ? { platform: validPlatform } : {}) },
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
