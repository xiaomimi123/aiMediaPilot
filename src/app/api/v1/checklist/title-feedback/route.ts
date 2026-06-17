import { ok, fail } from '@/lib/api';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { TITLE_CRITIQUE } from '@/lib/llm/prompts/title-critique';

export async function POST(req: Request) {
  let body: { title?: unknown; niche?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';

  if (title.length < 3 || title.length > 100) {
    return fail('title 必须 3-100 字符', 400);
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
      systemPrompt: TITLE_CRITIQUE.buildSystemPrompt(niche),
      userMessage: TITLE_CRITIQUE.buildUserMessage({ title }),
      responseSchema: TITLE_CRITIQUE.responseSchema,
    });
    return ok(out.result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST title-feedback]', e);
    return fail(`评估失败: ${msg}`, 500);
  }
}
