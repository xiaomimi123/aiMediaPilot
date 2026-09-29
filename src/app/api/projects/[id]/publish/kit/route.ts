import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { generatePublishKit } from '@/lib/retro/publish-kit';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const key = getDeepSeekKey();
  if (!key) return fail('没有配置 DeepSeek key：去设置页填入后再试。', 400);
  const p = await prisma.project.findUnique({ where: { id: params.id }, include: { benchmarkVideo: true } });
  if (!p) return fail('找不到这个项目', 404);
  const s = ScriptSchema.safeParse(p.script);
  if (!s.success) return fail('还没有稿子，先写稿再生成发布文案。', 400);
  const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
  try {
    const kit = await generatePublishKit(new DeepSeekTextLLM({ apiKey: key }), {
      scriptText: s.data.segments.map((x) => `${ROLE_LABEL[x.role]}：${x.text}`).join('\n'),
      personaText: formatPersona((p.personaSnapshot as PersonaLike | null) ?? null),
      benchmarkTitlePattern: a?.success ? a.data.titlePattern : undefined,
    });
    await prisma.project.update({ where: { id: p.id }, data: { publishKit: kit as unknown as Prisma.InputJsonValue } });
    return ok(kit);
  } catch {
    return fail('发布文案没写出来（DeepSeek 没按格式回答），再点一次。', 502);
  }
}
