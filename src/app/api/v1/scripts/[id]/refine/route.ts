import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getStyleContext } from '@/lib/script/style';
import { SCRIPT_REFINE } from '@/lib/llm/prompts/script-refine';
import { ScriptSectionSchema, type DouyinFullScript } from '@/lib/llm/prompts/script-write-douyin';
import { ResearchBriefSchema, type ResearchBrief } from '@/lib/llm/prompts/research-brief';

/**
 * 两级改稿路由 — scope='section' 只重写指定块 (服务端校验其余块 text 逐字不变),
 * scope='all' 按 instruction 重写全稿 (服务端只校验块数 3-6 与首块 role='hook')。
 *
 * 复用 output.research (不重新搜索), 定稿即整体替换 output.script.sections 持久化,
 * output 里的其余键 (hooks/titles/cover/durationSec/research) 原样保留。
 */

const MIN_INSTRUCTION_LEN = 1;
const MAX_INSTRUCTION_LEN = 200;

interface RefineBody {
  scope?: unknown;
  sectionIdx?: unknown;
  instruction?: unknown;
}

// 防御性读取 ScriptDraft.output — 旧稿可能没有 research/script 键, 一律 null 兜底。
const ScriptOutputReadSchema = z
  .object({
    script: z.object({ sections: z.array(ScriptSectionSchema).min(1) }),
    research: ResearchBriefSchema.nullable().optional(),
  })
  .passthrough();

function textsEqualExceptTarget(
  original: DouyinFullScript['sections'],
  updated: DouyinFullScript['sections'],
  targetIdx: number,
): boolean {
  if (original.length !== updated.length) return false;
  return original.every((s, i) => i === targetIdx || s.text === updated[i].text);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: RefineBody;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const scope = body.scope;
  if (scope !== 'section' && scope !== 'all') {
    return fail("scope 必须是 'section' 或 'all'", 400);
  }

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction.length < MIN_INSTRUCTION_LEN || instruction.length > MAX_INSTRUCTION_LEN) {
    return fail('instruction 必须是 1-200 字符', 400);
  }

  let sectionIdx: number | undefined;
  if (scope === 'section') {
    if (typeof body.sectionIdx !== 'number' || !Number.isInteger(body.sectionIdx) || body.sectionIdx < 0) {
      return fail('sectionIdx 必须是非负整数', 400);
    }
    sectionIdx = body.sectionIdx;
  }

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true, niche: true, platform: true, output: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  if (draft.platform !== 'douyin') return fail('仅支持抖音脚本改稿', 400);

  const parsedOutput = ScriptOutputReadSchema.safeParse(draft.output);
  if (!parsedOutput.success) return fail('该脚本还没有可改写的逐字稿, 请先生成', 400);

  const sections = parsedOutput.data.script.sections;
  const research: ResearchBrief | null = parsedOutput.data.research ?? null;

  if (scope === 'section' && sectionIdx !== undefined && sectionIdx >= sections.length) {
    return fail('sectionIdx 超出范围', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 503);

  const style = await getStyleContext(user.id, 'douyin');
  const llm = getDeepSeekTextLLM(apiKey);

  const systemPrompt =
    scope === 'section'
      ? SCRIPT_REFINE.buildSectionSystemPrompt(draft.niche, style)
      : SCRIPT_REFINE.buildAllSystemPrompt(draft.niche, style);

  try {
    const out = await llm.callStructured({
      systemPrompt,
      userMessage: SCRIPT_REFINE.buildUserMessage({ sections, instruction, targetIdx: sectionIdx, brief: research }),
      responseSchema: SCRIPT_REFINE.responseSchema,
    });
    const newSections = out.result.sections;

    if (scope === 'section') {
      if (sectionIdx === undefined || !textsEqualExceptTarget(sections, newSections, sectionIdx)) {
        return fail('AI 修改了未指定的段落, 请重试', 502);
      }
    } else {
      if (newSections.length < 3 || newSections.length > 6 || newSections[0].role !== 'hook') {
        return fail('AI 修改了未指定的段落, 请重试', 502);
      }
    }

    await prisma.scriptDraft.update({
      where: { id },
      data: {
        output: {
          ...(draft.output as Record<string, unknown>),
          script: { sections: newSections },
        },
      },
    });

    return ok({ sections: newSections });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/refine]', e);
    return fail(`改稿失败: ${msg}`, 500);
  }
}
