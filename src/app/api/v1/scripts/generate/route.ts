import { ok, fail } from '@/lib/api';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { SCRIPT_GENERATE } from '@/lib/llm/prompts/script-generate-douyin';

export async function POST(req: Request) {
  let body: { topic?: unknown; niche?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';

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

  const llm = new DeepSeekTextLLM({ apiKey });
  try {
    const out = await llm.callStructured({
      systemPrompt: SCRIPT_GENERATE.buildSystemPrompt(niche),
      userMessage: SCRIPT_GENERATE.buildUserMessage({ topic }),
      responseSchema: SCRIPT_GENERATE.responseSchema,
    });
    return ok(out.result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/generate]', e);
    return fail(`生成失败: ${msg}`, 500);
  }
}
