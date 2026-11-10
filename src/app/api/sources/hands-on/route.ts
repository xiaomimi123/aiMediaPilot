import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { fetchReadme } from '@/lib/sources/news';
import { designHandsOn, handsOnIdeaText } from '@/lib/sources/hands-on';
import { addIdea } from '@/lib/topics/daily';
import { HANDS_ON_TARGET_SEC } from '@/lib/sources/hands-on';
import { createProject } from '@/lib/project/create';
import { toProjectView } from '@/lib/project/view';
import { rewriteWithAnswers } from '@/lib/topics/generate';
import { writeScript } from '@/lib/script/write';
import { recentSampleTexts } from '@/lib/voice/samples';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';

export const dynamic = 'force-dynamic';

type Body = { outerId?: string; ideaId?: string; action?: 'plan' | 'write'; questions?: unknown; answers?: unknown };

/** 拿这个亲测档选题的点子原文(建作品后要点子池里用掉它) */
async function findIdea(db: typeof prisma, id: string) {
  return db.topicIdea.findUnique({ where: { id } });
}

/** POST: action=plan 生成实测清单存点子池; action=write 按用户答的实测结果写 90 秒稿并建作品 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const outerId = String(b.outerId ?? '').trim();
  if (!outerId) return fail('缺仓库标识', 400);
  const item = await prisma.sourceItem.findFirst({ where: { provider: 'github', outerId } });
  if (!item) return fail('这个仓库不在信息源里，等下次抓取或先去「选题」页看看列表', 404);
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);

  try {
    const readme = await fetchReadme(outerId);

    if (b.action === 'write') {
      const ideaId = String(b.ideaId ?? '').trim();
      const idea = ideaId ? await findIdea(prisma, ideaId) : null;
      if (!idea) return fail('点子池里找不到这条亲测档选题（可能已删），重新升级一次', 404);
      const answers = (Array.isArray(b.answers) ? b.answers : []).map((x) => String(x ?? '').trim());
      if (!answers.some((a) => a)) return fail('先答至少一个实测问题', 400);
      // 问题清单跟回答逐项配对(前端把 plan 返回的问题原样带回来)
      const questions = (Array.isArray(b.questions) ? b.questions : []).map((x) => String(x ?? '').trim()).filter(Boolean);

      // 从点子原文里取标题/方向/钩子(生成时写进去的格式, 见 hands-on.ts)
      const text = idea.text;
      const title = text.match(/标题方向：(.+)/)?.[1] ?? `我试了 ${outerId}`;
      const direction = text.match(/讲什么：(.+)/)?.[1] ?? '';
      const hook = text.match(/钩子方向：(.+)/)?.[1] ?? '';
      const { script } = await rewriteWithAnswers(
        {
          llm: m.llm,
          noModelReason: NO_MODEL_MESSAGE,
          write: (o) => writeScript({ ...o, targetSec: HANDS_ON_TARGET_SEC }),
          predict: async () => null,
          personaText: formatPersona((await prisma.personaProfile.findUnique({ where: { id: 'me' } })) as PersonaLike | null),
          lessons: '',
          samples: await recentSampleTexts(prisma),
        },
        { title, hook, direction, source: 'idea', sourceId: idea.id, questions, material: `【README 摘录】\n${readme.text}` },
        answers,
      );
      const p = await createProject(prisma, title, { script, targetSec: HANDS_ON_TARGET_SEC });
      await prisma.topicIdea.update({ where: { id: idea.id }, data: { status: 'used' } });
      return ok({ project: toProjectView(p), script, ideaId: idea.id });
    }

    // 默认 action=plan: 生成实测问题清单, 存点子池
    const plan = await designHandsOn({ llm: m.llm, repo: outerId, starCount: item.heat, readme: readme.text });
    const idea = await addIdea(prisma, handsOnIdeaText(plan, outerId, item.heat));
    return ok({ ideaId: idea.id, title: plan.title, hook: plan.hook, direction: plan.direction, questions: plan.questions });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
