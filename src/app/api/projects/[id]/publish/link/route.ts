import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveLink } from '@/lib/benchmark/link';
import { linkWork } from '@/lib/retro/match';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { workId?: string; text?: string };
  let workId = typeof body.workId === 'string' ? body.workId : null;
  if (!workId && typeof body.text === 'string') {
    const t = await resolveLink(body.text).catch(() => null);
    if (!t || t.kind !== 'video') return fail('这不是抖音视频链接。在抖音里点「分享 → 复制链接」再粘贴。', 400);
    const w = await prisma.publishedWork.findFirst({ where: { platform: 'douyin', externalId: t.awemeId } });
    if (!w) return fail('库里还没有这条作品（可能刚发布），等今晚回采后再关联。', 400);
    workId = w.id;
  }
  if (!workId) return fail('没指定作品', 400);
  try {
    await linkWork(prisma, params.id, workId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '关联失败', 400);
  }
  return ok({ linked: true });
}
