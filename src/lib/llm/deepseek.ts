import { OpenAIVisionLLM, type CallStructuredOpts, type ContentPart, type TokenUsage } from './vision';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

export interface DeepSeekTextLLMOpts {
  apiKey: string;
  maxRetries?: number;
  defaultModel?: string;
}

/**
 * DeepSeek 文本 LLM 适配器。 OpenAI-compatible API,但不支持视觉 (image_url parts) 和
 * beta.chat.completions.parse 结构化输出。 用 JSON-mode + 手动 Zod 校验 fallback。
 */
export class DeepSeekTextLLM extends OpenAIVisionLLM {
  constructor(opts: DeepSeekTextLLMOpts) {
    super({
      apiKey: opts.apiKey,
      baseURL: DEEPSEEK_BASE_URL,
      jsonModeFallback: true,
      maxRetries: opts.maxRetries,
      defaultModel: opts.defaultModel ?? 'deepseek-chat',
    });
  }

  async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
    // 视觉调用守门: DeepSeek 当前 API 不开放视觉 (2026-06 现状)。 含 image_url 直接抛错。
    if (opts.userMessage.some((p: ContentPart) => p.type === 'image_url')) {
      throw new Error('DeepSeekTextLLM 不支持视觉调用 (image_url parts)。 请改用 OpenAIVisionLLM。');
    }
    return super.callStructured(opts);
  }
}
