import { ok, fail } from '@/lib/api';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { CRITIQUE_BY_PLATFORM, type CritiquePlatform } from '@/lib/llm/prompts';
import { ipKey, rateLimit } from '@/lib/rate-limit';
import { normalizeNiche } from '@/lib/niche';
import { isContentPlatform } from '@/lib/platform';
import { getOrCreateDefaultUser } from '@/lib/user';

// title-critique 的支持平台恰好等于 ContentPlatform, CritiquePlatform 名义上不同但值一致
const isCritiquePlatform = (v: unknown): v is CritiquePlatform => isContentPlatform(v);

export async function POST(req: Request) {
  // 前端已 debounce 1.5s + AbortController; 后端限流是 client-bypass 兜底,
  // 3 秒窗口内最多 3 次 — 正常前端一次修改只触发 1 次, 攻击/bypass 就挡住。
  const rl = rateLimit(`title-feedback:${ipKey(req)}`, { limit: 3, windowMs: 3000 });
  if (!rl.ok) {
    return fail(`太频繁, 请 ${Math.ceil(rl.resetInMs / 1000)}s 后再试`, 429);
  }

  let body: { title?: unknown; niche?: unknown; platform?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const niche = normalizeNiche(typeof body.niche === 'string' ? body.niche : '');
  const platform: CritiquePlatform = isCritiquePlatform(body.platform) ? body.platform : 'douyin';

  if (title.length < 3 || title.length > 100) {
    return fail('title 必须 3-100 字符', 400);
  }
  if (!niche) {
    return fail('niche 不能为空', 400);
  }

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  const prompt = CRITIQUE_BY_PLATFORM[platform];
  const llm = getDeepSeekTextLLM(apiKey);
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
