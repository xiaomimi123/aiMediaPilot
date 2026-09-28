import { z } from 'zod';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { createPrismaStore } from '@/lib/benchmark/store';
import { formatPersona, type PersonaLike, type Tool } from './types';

const Input = z.object({});

export const suggestTopicsTool: Tool<z.infer<typeof Input>> = {
  name: 'suggest_topics',
  label: '找选题',
  description: '用户还没定这条讲什么、请你帮忙找选题时调用。从近 14 天的对标爆款里挑 3 个适合用户的选题。项目已有稿子时不要用。',
  input: Input,
  async execute(ctx) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    if (project.script) return { ok: false, summary: '找选题：这个项目已经有稿子了，找选题请新建项目或去「选题」页' };
    const r = await suggestTopics({
      store: createPrismaStore(ctx.db),
      llm: ctx.llm,
      personaText: formatPersona((project.personaSnapshot as PersonaLike | null) ?? null),
      myTopTitles: await loadMyTopTitles(ctx.db),
      now: new Date(),
    });
    if (!r.ok) return { ok: false, summary: `找选题：${r.reason}` };
    return {
      ok: true,
      summary: `找选题：${r.topics.length} 个`,
      data: { topics: r.topics.map((t) => ({ topic: t.topic, why: t.why, hook: t.hook, 参考: t.sources.map((s) => `${s.author}（平时的 ${s.ratio ?? '?'} 倍）：${s.desc.slice(0, 40)}`) })) },
    };
  },
};
