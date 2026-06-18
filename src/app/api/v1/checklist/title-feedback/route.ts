import { ok, fail } from '@/lib/api';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { CRITIQUE_BY_PLATFORM, type CritiquePlatform } from '@/lib/llm/prompts/title-critique';

function isCritiquePlatform(v: unknown): v is CritiquePlatform {
  return v === 'douyin' || v === 'xiaohongshu' || v === 'gongzhonghao';
}

export async function POST(req: Request) {
  let body: { title?: unknown; niche?: unknown; platform?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';
  const platform: CritiquePlatform = isCritiquePlatform(body.platform) ? body.platform : 'douyin';

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

  const prompt = CRITIQUE_BY_PLATFORM[platform];
  const llm = new DeepSeekTextLLM({ apiKey });
  try {
    const out = await llm.callStructured({
      systemPrompt: prompt.buildSystemPrompt(niche),
      userMessage: prompt.buildUserMessage({ title }),
      responseSchema: prompt.responseSchema,
    });
    return ok(out.result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST title-feedback]', e);
    return fail(`评估失败: ${msg}`, 500);
  }
}
