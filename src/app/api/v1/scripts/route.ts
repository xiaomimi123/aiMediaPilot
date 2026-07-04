import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import {
  DouyinScriptResponseSchema,
  XHSScriptResponseSchema,
  ArticleScriptResponseSchema,
} from '@/lib/llm/prompts';
import { normalizeNiche } from '@/lib/niche';
import { isContentPlatform, type ContentPlatform } from '@/lib/platform';

const SCHEMA_BY_PLATFORM: Record<ContentPlatform, typeof DouyinScriptResponseSchema | typeof XHSScriptResponseSchema | typeof ArticleScriptResponseSchema> = {
  douyin: DouyinScriptResponseSchema,
  xiaohongshu: XHSScriptResponseSchema,
  gongzhonghao: ArticleScriptResponseSchema,
};

export async function POST(req: Request) {
  let body: { topic?: unknown; niche?: unknown; platform?: unknown; output?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = normalizeNiche(typeof body.niche === 'string' ? body.niche : '');
  const platform: ContentPlatform = isContentPlatform(body.platform) ? body.platform : 'douyin';
  if (!topic || !niche) return fail('topic 和 niche 必填', 400);

  const parsed = SCHEMA_BY_PLATFORM[platform].safeParse(body.output);
  if (!parsed.success) return fail(`output schema 不合法 (${platform}): ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  try {
    const draft = await prisma.scriptDraft.create({
      data: { userId: user.id, topic, niche, platform, output: parsed.data as any },
      select: { id: true },
    });
    return ok({ id: draft.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, topic: true, niche: true, platform: true, createdAt: true, analysisId: true },
  });
  return ok({
    items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
  });
}
