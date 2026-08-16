import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getStyleContext } from '@/lib/script/style';
import { SCRIPT_REFINE } from '@/lib/llm/prompts/script-refine';
import { XHS_REFINE } from '@/lib/llm/prompts/xhs-refine';
import { ScriptSectionSchema, buildStyleSection, type DouyinScriptSection } from '@/lib/llm/prompts/script-write-douyin';
import { getExpertPersona } from '@/lib/llm/prompts/expert-persona';
import { JSON_STRICTNESS } from '@/lib/llm/prompts/base';
import { ResearchBriefSchema, type ResearchBrief } from '@/lib/llm/prompts/research-brief';
import {
  ACT_KEYS,
  ACT_LABELS,
  isSixActScript,
  ScriptActSchema,
  type ActKey,
  type ScriptAct,
  type FourDims,
} from '@/lib/script/six-act';

/**
 * 两级改稿路由 — scope='section' 只重写指定块 (服务端校验其余块 text 逐字不变),
 * scope='all' 按 instruction 重写全稿 (服务端只校验块数 3-6 与首块 role='hook')。
 *
 * 复用 output.research (不重新搜索), 定稿即整体替换 output.script.sections 持久化,
 * output 里的其余键 (hooks/titles/cover/durationSec/research) 原样保留。
 *
 * 十三期任务四: douyin 新增六幕改稿分岔 (scope='act'/'all' 对六幕稿生效) ——
 * `isSixActScript` (T1 唯一形状判别入口) 决定一份 draft.output 走旧 sections
 * 分支还是新 acts 分支, 两套逻辑互不相扰。旧稿 scope='section'+sectionIdx 原逻辑
 * 完全不变 (见下方 handleSixActRefine 之外的原有代码)。
 */

const MIN_INSTRUCTION_LEN = 1;
const MAX_INSTRUCTION_LEN = 200;

interface RefineBody {
  scope?: unknown;
  sectionIdx?: unknown;
  actKey?: unknown;
  instruction?: unknown;
}

/**
 * 六幕改稿 LLM 响应 schema —— 每幕字段复用 six-act.ts 真实的 `ScriptActSchema` (严格上限 +
 * 宽进严出截断, 修复审查意见#2: 此前这里是一份手写的宽松 copy, 越界字段会被原样持久化,
 * 导致该稿此后 isSixActScript 判别失效)。数组只校验恰好 6 项, **不**在这里做顺序 superRefine
 * (顺序/越权改动由下方服务端自行核对并返回 502, 同 scope='section' 先例 —— 若在这里就用
 * SixActScriptSchema 的顺序校验, 顺序错误会在 callStructured 内部直接 parse 失败抛出, 变成
 * 500 而不是我们想要的 502)。
 */
const SixActRefineResponseSchema = z.object({ acts: z.array(ScriptActSchema).length(6) });

// 防御性读取 ScriptDraft.output — 旧稿可能没有 research/script 键, 一律 null 兜底。
const ScriptOutputReadSchema = z
  .object({
    script: z.object({ sections: z.array(ScriptSectionSchema).min(1) }),
    research: ResearchBriefSchema.nullable().optional(),
  })
  .passthrough();

// 小红书整稿改稿只需要 intro/body 存在即可改写, 其余四键 (titles/coverText/tags/shotIdeas)
// 原样透传, 不参与本次校验。
const XhsOutputReadSchema = z
  .object({
    intro: z.string().min(1),
    body: z.string().min(1),
    research: ResearchBriefSchema.nullable().optional(),
  })
  .passthrough();

function textsEqualExceptTarget(
  original: DouyinScriptSection[],
  updated: DouyinScriptSection[],
  targetIdx: number,
): boolean {
  if (original.length !== updated.length) return false;
  return original.every((s, i) => i === targetIdx || s.text === updated[i].text);
}

/**
 * 六幕版 scope='act' 越权改动守卫 —— 与 textsEqualExceptTarget 同一先例, 但比对两件事
 * (修复审查意见#1: 此前只比 narration, 没比 act key/顺序, 一份 act 值被错标或整体挪位、
 * narration 恰好仍按原索引对齐的响应会被静默放行, 写坏"六幕 key 与顺序固定"这条不变量):
 * 1. 每个位置的 act 字段必须等于 ACT_KEYS 里该位置应有的值 (含 target 位置本身) ——
 *    保证 key 与顺序没被打乱/错标;
 * 2. 除 targetAct 外, 其余每个位置的 narration 必须与原稿逐字相同。
 */
function actsValidForTargetEdit(
  original: ScriptAct[],
  updated: { act: string; narration: string }[],
  targetAct: ActKey,
): boolean {
  if (updated.length !== ACT_KEYS.length || original.length !== ACT_KEYS.length) return false;
  return ACT_KEYS.every((expected, i) => {
    if (updated[i]?.act !== expected) return false;
    if (expected === targetAct) return true;
    return updated[i]?.narration === original[i]?.narration;
  });
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
  if (scope !== 'section' && scope !== 'all' && scope !== 'act') {
    return fail("scope 必须是 'section'、'all' 或 'act'", 400);
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

  let actKey: ActKey | undefined;
  if (scope === 'act') {
    if (typeof body.actKey !== 'string' || !(ACT_KEYS as readonly string[]).includes(body.actKey)) {
      return fail(`actKey 必须是六幕之一: ${ACT_KEYS.join('/')}`, 400);
    }
    actKey = body.actKey as ActKey;
  }

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true, niche: true, platform: true, output: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  if (draft.platform === 'xiaohongshu') {
    return handleXhsRefine({ id, scope, instruction, draft, userId: user.id });
  }
  if (draft.platform !== 'douyin') return fail('仅支持抖音/小红书脚本改稿', 400);

  // 六幕稿分岔 (T4): draft.output 里 script.acts + 顶层 four_dims 拼起来喂给
  // isSixActScript (T1 唯一形状判别入口) 判定, 命中即整段交给 handleSixActRefine,
  // 完全不进入下方旧 sections 校验/改写逻辑。
  const rawOutput = draft.output && typeof draft.output === 'object' ? (draft.output as Record<string, unknown>) : null;
  const sixActCandidate = rawOutput
    ? { acts: (rawOutput.script as Record<string, unknown> | undefined)?.acts, four_dims: rawOutput.four_dims }
    : null;

  if (isSixActScript(sixActCandidate)) {
    if (scope === 'section') return fail('该脚本是六幕稿, 请使用 scope=act 按幕改稿', 400);
    return handleSixActRefine({
      id,
      scope,
      actKey,
      instruction,
      niche: draft.niche,
      userId: user.id,
      rawOutput: rawOutput as Record<string, unknown>,
      script: sixActCandidate,
    });
  }
  if (scope === 'act') return fail('该脚本还没有可改写的六幕稿, 请先生成', 400);

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

/**
 * 小红书整稿改稿 — 只重写 intro/body 两个区块, titles/coverText/tags/shotIdeas
 * 从 draft.output spread 原样透传, 构造上不可能被本次改写覆盖。
 */
async function handleXhsRefine(args: {
  id: string;
  scope: 'section' | 'all' | 'act';
  instruction: string;
  draft: { niche: string; output: unknown };
  userId: string;
}) {
  const { id, scope, instruction, draft, userId } = args;

  // 小红书没有分块/分幕改稿, 'section' 与 'act' 都归入同一条不支持提示 (act 是六幕稿概念,
  // 小红书 draft.output 永远不会满足 isSixActScript, 提前挡在这里避免落到下面误当 'all' 处理)。
  if (scope !== 'all') return fail('小红书暂不支持分块改稿', 400);

  const parsedOutput = XhsOutputReadSchema.safeParse(draft.output);
  if (!parsedOutput.success) return fail('该脚本还没有可改写的图文笔记, 请先生成', 400);

  const { intro, body, research } = parsedOutput.data;

  const apiKey = await resolveDeepSeekApiKey(userId);
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 503);

  const style = await getStyleContext(userId, 'xiaohongshu');
  const llm = getDeepSeekTextLLM(apiKey);

  try {
    const out = await llm.callStructured({
      systemPrompt: XHS_REFINE.buildSystemPrompt(draft.niche, style),
      userMessage: XHS_REFINE.buildUserMessage({ intro, body, instruction, brief: research ?? null }),
      responseSchema: XHS_REFINE.responseSchema,
    });
    const { intro: newIntro, body: newBody } = out.result;

    await prisma.scriptDraft.update({
      where: { id },
      data: {
        output: {
          ...(draft.output as Record<string, unknown>),
          intro: newIntro,
          body: newBody,
        },
      },
    });

    return ok({ intro: newIntro, body: newBody });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/refine xiaohongshu]', e);
    return fail(`改稿失败: ${msg}`, 500);
  }
}

/**
 * 六幕逐字稿改稿 (十三期任务四) — scope='act' 只重写 actKey 指定的那一幕, 服务端校验
 * 其余五幕 narration 逐字不变 (同 scope='section' 守卫先例, 违者 502 不写库);
 * scope='all' 重写全部六幕, 校验 acts 恰好六项且 act 值按 ACT_KEYS 顺序排列。
 * 复用 output 里的其余键 (research/hooks/titles/cover/durationSec/four_dims/lintIssues)
 * 原样透传, 定稿即整体替换 output.script.acts。
 */
async function handleSixActRefine(args: {
  id: string;
  scope: 'act' | 'all';
  actKey?: ActKey;
  instruction: string;
  niche: string;
  userId: string;
  rawOutput: Record<string, unknown>;
  script: { acts: ScriptAct[]; four_dims: FourDims };
}) {
  const { id, scope, actKey, instruction, niche, userId, rawOutput, script } = args;
  const { acts } = script;

  const apiKey = await resolveDeepSeekApiKey(userId);
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 503);

  const style = await getStyleContext(userId, 'douyin');
  const llm = getDeepSeekTextLLM(apiKey);

  const actsText = acts
    .map((a, i) => `[${i}] act=${a.act} (${ACT_LABELS[a.act]}) targetSec=${a.targetSec}s\n${a.narration}`)
    .join('\n\n');

  const systemPrompt =
    scope === 'act'
      ? `${getExpertPersona(niche)}

任务: 你收到一份已经写好的抖音口播六幕逐字稿 (按 acts 分幕, 固定顺序 hook/concept_a/concept_b/trivia/synthesis/punchline), 用户只想重写其中一幕 (targetAct 指定), 其余五幕必须原样返回。

改写要求:
- 只重写 targetAct 指定的那一幕, 其余五幕的 act/title/narration/visual/note/targetSec/beats/facts 必须逐字原样返回, 不允许有任何改动
- 被重写的这一幕 act 字段与 targetSec 保持不变, 只改这一幕的内容
- 新的 narration 依然要是能直接照着念的口语逐字稿, 短句, 拒绝书面语
- 严格按用户给出的 instruction 改写, 不要自由发挥偏离要求

${buildStyleSection(style)}

${JSON_STRICTNESS}`
      : `${getExpertPersona(niche)}

任务: 你收到一份已经写好的抖音口播六幕逐字稿 (按 acts 分幕), 按用户给出的 instruction 重写全部六幕。

改写要求:
- 保持六幕固定顺序不变 (依次为 hook/concept_a/concept_b/trivia/synthesis/punchline), 幕数固定为 6, 不允许增减幕数或打乱顺序
- 每幕 targetSec 原样保留
- 新的 narration 依然要是能直接照着念的口语逐字稿, 短句, 拒绝书面语
- 严格按用户给出的 instruction 执行改写, 不要自由发挥偏离要求

${buildStyleSection(style)}

${JSON_STRICTNESS}`;

  const targetLine =
    scope === 'act' && actKey
      ? `\n\n本次只重写 ${actKey} (${ACT_LABELS[actKey]}) 这一幕, 其余五幕原样返回。`
      : '';

  try {
    const out = await llm.callStructured({
      systemPrompt,
      userMessage: [
        {
          type: 'text',
          text: `当前逐字稿 (六幕):
${actsText}

改写要求: ${instruction}${targetLine}

按 schema 输出完整 acts (六项)。`,
        },
      ],
      responseSchema: SixActRefineResponseSchema,
    });
    const newActs = out.result.acts;

    if (scope === 'act') {
      if (!actKey || !actsValidForTargetEdit(acts, newActs, actKey)) {
        return fail('AI 修改了未指定的幕, 请重试', 502);
      }
    } else {
      if (newActs.length !== 6 || !ACT_KEYS.every((key, i) => newActs[i]?.act === key)) {
        return fail('AI 修改了幕的数量或顺序, 请重试', 502);
      }
    }

    await prisma.scriptDraft.update({
      where: { id },
      data: {
        output: {
          ...rawOutput,
          script: { acts: newActs },
        },
      },
    });

    return ok({ acts: newActs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/refine six-act]', e);
    return fail(`改稿失败: ${msg}`, 500);
  }
}
