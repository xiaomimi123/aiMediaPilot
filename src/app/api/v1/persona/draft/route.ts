import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { PERSONA_DRAFT } from '@/lib/llm/prompts';

/**
 * AI 访谈式建档 — 起草路由 (八期 T2)。
 *
 * 设计文档 (docs/superpowers/specs/2026-08-14-persona-driven-topics-design.md §2):
 * 「草稿只回填表单不落库, 用户修改后点保存才走 PUT」—— 本路由**不**写 PersonaProfile,
 * 只读 StyleProfile/StyleSample/RadarKeyword 拼装 prompt 输入, 调 LLM, 原样把结果返回
 * 给前端表单回填。
 *
 * niche 硬编码 'ai-knowledge': 产品当前只服务 AI 知识赛道创作者 (同 radar-read 先例),
 * 访谈本身也不收集 niche —— 9 问里没有"你是什么赛道", 没有别的来源可取。
 *
 * 十期 T3: 访谈从 5 问扩展到 9 问 (新增痛点/变现/转化路径/竞争格局四问), answers 上限
 * 随之从 8 提到 9; 起草仍然不落库 (八期语义不变, 见下方 POST 内注释)。
 */
const DEFAULT_NICHE = 'ai-knowledge';
const RECENT_SAMPLE_COUNT = 3;
const SAMPLE_EXCERPT_CHARS = 200;

const AnswerSchema = z.object({
  q: z.string().min(1),
  a: z.string(), // 可空串 — 用户跳过某问
});

const DraftRequestSchema = z.object({
  answers: z.array(AnswerSchema).min(1).max(9),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = DraftRequestSchema.safeParse(body);
  if (!parsed.success) return fail(`访谈数据不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  const [styleProfile, recentSamples, activeKeywords] = await Promise.all([
    prisma.styleProfile.findUnique({ where: { userId: user.id } }),
    prisma.styleSample.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SAMPLE_COUNT,
    }),
    prisma.radarKeyword.findMany({
      where: { userId: user.id, status: 'active' },
      select: { text: true },
    }),
  ]);

  const styleDescription = styleProfile?.description ?? '';
  const sampleExcerpts = recentSamples.map((s) => s.content.slice(0, SAMPLE_EXCERPT_CHARS));
  const radarKeywords = activeKeywords.map((k) => k.text);

  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: PERSONA_DRAFT.buildSystemPrompt(DEFAULT_NICHE),
      userMessage: PERSONA_DRAFT.buildUserMessage({
        answers: parsed.data.answers,
        styleDescription,
        sampleExcerpts,
        radarKeywords,
      }),
      responseSchema: PERSONA_DRAFT.responseSchema,
    });
    return ok({ draft: out.result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST persona/draft]', e);
    return fail(`起草失败: ${msg}`, 500);
  }
}
