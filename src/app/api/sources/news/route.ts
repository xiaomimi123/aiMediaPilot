import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { writeNewsScript, fetchReadme, NEWS_TARGET_SEC } from '@/lib/sources/news';
import { createProject } from '@/lib/project/create';
import { toProjectView } from '@/lib/project/view';

export const dynamic = 'force-dynamic';

type Body = { outerId?: string; action?: 'preview' | 'create'; topic?: string; title?: string };

/** 从 SourceItem 里找 github 条目 */
async function findItem(outerId: string) {
  return prisma.sourceItem.findFirst({ where: { provider: 'github', outerId } });
}

/** POST: 生成快讯稿预览; body.create=true 时直接建作品(稿子即脚本) */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const outerId = String(b.outerId ?? '').trim();
  if (!outerId) return fail('缺仓库标识', 400);
  const item = await findItem(outerId);
  if (!item) return fail('这个仓库不在信息源里，等下次抓取或先去「选题」页看看列表', 404);
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);

  let readme: { text: string; url: string };
  try {
    readme = await fetchReadme(outerId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'README 没抓到', 502);
  }

  try {
    const out = await writeNewsScript({
      llm: m.llm,
      repo: outerId,
      starCount: item.heat,
      readme: readme.text,
      topic: b.topic?.trim() || null,
    });
    // 快讯不讲亲身经历, 原文不作说话样本
    if (b.action === 'create') {
      const p = await createProject(prisma, b.title?.trim() || out.title, { script: out.script, targetSec: NEWS_TARGET_SEC });
      return ok({ ...out, project: toProjectView(p) });
    }
    return ok({ ...out, readmeUrl: readme.url });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
