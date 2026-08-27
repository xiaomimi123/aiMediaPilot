import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { combineScore, readActsFromDraftOutput, type CombinedScore } from '@/lib/cockpit/script-score';

/**
 * 首页「今天要做的」的评分徽章数据源(二十二期)。
 *
 * 单独开一个批量接口而不是让每张卡片各调一次 [id]/script-score:
 * 首页一屏十几条内容, 逐条请求会打出十几个往返。这里两次查询查完所有人。
 *
 * 同样**不触发模型调用** —— 只算硬指标 + 读软指标缓存。
 */
export async function GET(_req: Request) {
  const user = await getOrCreateDefaultUser();
  const contents = await prisma.cockpitContent.findMany({
    where: { userId: user.id, scriptDraftId: { not: null } },
    select: { id: true, scriptDraftId: true, scriptScore: true },
  });

  const draftIds = contents.map((c) => c.scriptDraftId).filter((x): x is string => Boolean(x));
  const drafts = draftIds.length
    ? await prisma.scriptDraft.findMany({ where: { id: { in: draftIds } }, select: { id: true, output: true } })
    : [];
  const byId = new Map(drafts.map((d) => [d.id, d.output]));

  const scores: Record<string, CombinedScore> = {};
  for (const c of contents) {
    const acts = readActsFromDraftOutput(byId.get(c.scriptDraftId!));
    // 认不出结构就跳过 —— 前端据此不渲染徽章, 而不是显示一个 0 分吓人
    if (!acts) continue;
    scores[c.id] = combineScore(acts, c.scriptScore);
  }

  return ok({ scores });
}
