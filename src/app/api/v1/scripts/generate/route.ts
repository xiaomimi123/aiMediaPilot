import { ok, fail } from '@/lib/api';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { SCRIPT_GENERATE_DOUYIN } from '@/lib/llm/prompts/script-generate-douyin';
import { SCRIPT_GENERATE_XIAOHONGSHU } from '@/lib/llm/prompts/script-generate-xiaohongshu';
import { SCRIPT_GENERATE_GONGZHONGHAO } from '@/lib/llm/prompts/script-generate-gongzhonghao';

const PROMPT_BY_PLATFORM = {
  douyin: SCRIPT_GENERATE_DOUYIN,
  xiaohongshu: SCRIPT_GENERATE_XIAOHONGSHU,
  gongzhonghao: SCRIPT_GENERATE_GONGZHONGHAO,
} as const;

type Platform = keyof typeof PROMPT_BY_PLATFORM;

function isPlatform(v: unknown): v is Platform {
  return v === 'douyin' || v === 'xiaohongshu' || v === 'gongzhonghao';
}

export async function POST(req: Request) {
  let body: { topic?: unknown; niche?: unknown; platform?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';
  const platform: Platform = isPlatform(body.platform) ? body.platform : 'douyin';

  if (topic.length < 3 || topic.length > 500) {
    return fail('topic 必须是 3-500 字符', 400);
  }
  if (!niche) {
    return fail('niche 不能为空', 400);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  const prompt = PROMPT_BY_PLATFORM[platform];
  const llm = new DeepSeekTextLLM({ apiKey });
  try {
    const out = await llm.callStructured({
      systemPrompt: prompt.buildSystemPrompt(niche),
      userMessage: prompt.buildUserMessage({ topic }),
      // Each platform has its own zod schema (different shape); union ambiguates the T inference
      responseSchema: prompt.responseSchema as any,
    });
    return ok({ platform, ...(out.result as Record<string, unknown>) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/generate]', e);
    return fail(`生成失败: ${msg}`, 500);
  }
}
