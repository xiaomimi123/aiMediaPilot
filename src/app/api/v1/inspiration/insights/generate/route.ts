import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { INSPIRATION_INSIGHT } from '@/lib/llm/prompts/inspiration-insight';

interface ReqBody {
  videoIds?: unknown;
  niche?: unknown;
}

export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const videoIds = Array.isArray(body.videoIds)
    ? body.videoIds.filter((v): v is string => typeof v === 'string')
    : [];
  if (videoIds.length < 2) return fail('至少选 2 条视频才能总结共性', 400);
  if (videoIds.length > 20) return fail('一次最多 20 条', 400);

  const niche = typeof body.niche === 'string' ? body.niche.trim() : undefined;

  const user = await getOrCreateDefaultUser();
  const videos = await prisma.inspirationVideo.findMany({
    where: { id: { in: videoIds }, userId: user.id },
    select: {
      id: true,
      title: true,
      authorName: true,
      playCount: true,
      likeCount: true,
      commentCount: true,
      duration: true,
      userNote: true,
      platform: true,
    },
  });
  if (videos.length !== videoIds.length) {
    return fail('部分视频不存在或不属于你', 404);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 500);

  // Infer batch platform — same across all → use it; else 'mixed'
  const platformSet = new Set(videos.map((v) => v.platform));
  const batchPlatform =
    platformSet.size === 1
      ? (videos[0].platform as 'douyin' | 'xiaohongshu' | 'gongzhonghao')
      : ('mixed' as const);

  const llm = new DeepSeekTextLLM({ apiKey });
  try {
    const out = await llm.callStructured({
      systemPrompt: INSPIRATION_INSIGHT.buildSystemPrompt(niche, batchPlatform),
      userMessage: INSPIRATION_INSIGHT.buildUserMessage({
        niche,
        platform: batchPlatform,
        videos: videos.map((v) => ({
          title: v.title,
          authorName: v.authorName,
          playCount: v.playCount ? Number(v.playCount) : null,
          likeCount: v.likeCount ? Number(v.likeCount) : null,
          commentCount: v.commentCount ? Number(v.commentCount) : null,
          duration: v.duration,
          userNote: v.userNote,
        })),
      }),
      responseSchema: INSPIRATION_INSIGHT.responseSchema,
    });
    // Persist
    const saved = await prisma.inspirationInsight.create({
      data: {
        userId: user.id,
        videoIds: videoIds as unknown as object,
        output: out.result as unknown as object,
      },
      select: { id: true },
    });
    return ok({ id: saved.id, output: out.result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST inspiration/insights/generate]', e);
    return fail(`总结失败: ${msg}`, 500);
  }
}
