import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { promises as fs } from 'fs';
import path from 'path';
import type { z, ZodSchema } from 'zod';
import { estimateCostUSD } from './pricing';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface TokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  estCostUSD: number;
}

export interface CallStructuredOpts<T> {
  systemPrompt: string;
  userMessage: ContentPart[];
  responseSchema: ZodSchema<T>;
  model?: 'gpt-4o' | 'gpt-4o-mini';
  maxTokens?: number;
}

export interface IVisionLLM {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }>;
}

export interface OpenAIVisionLLMOpts {
  apiKey: string;
  maxRetries?: number;
  defaultModel?: 'gpt-4o' | 'gpt-4o-mini';
}

export class OpenAIVisionLLM implements IVisionLLM {
  private client: OpenAI;
  private maxRetries: number;
  private defaultModel: 'gpt-4o' | 'gpt-4o-mini';

  constructor(opts: OpenAIVisionLLMOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.maxRetries = opts.maxRetries ?? 3;
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
  }

  async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
    const model = opts.model ?? this.defaultModel;
    const userMessage = await this.encodeFileImages(opts.userMessage);

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const p = this.client.beta.chat.completions.parse({
        model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: userMessage as any },
        ],
        response_format: zodResponseFormat(opts.responseSchema as z.ZodTypeAny, 'response'),
        max_tokens: opts.maxTokens,
      });
      // Node.js fires 'unhandledRejection' if a Promise is rejected before
      // any rejection handler is attached. Because .parse() returns immediately
      // with a Promise that may reject before the try/await line below runs
      // (a microtask boundary exists here), we pre-attach a no-op handler.
      // The actual error is still caught by the try/catch below.
      p.catch(() => undefined);
      try {
        const completion = await p;
        const parsed = completion.choices[0]?.message.parsed as T;
        const usage = completion.usage;
        return {
          result: parsed,
          usage: {
            model: completion.model ?? model,
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            estCostUSD: estimateCostUSD(model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
          },
        };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        }
      }
    }
    throw lastError;
  }

  /** 把 image_url.url 里的 file:// 本地路径转 base64 data URL */
  private async encodeFileImages(parts: ContentPart[]): Promise<ContentPart[]> {
    const out: ContentPart[] = [];
    for (const part of parts) {
      if (part.type === 'image_url' && part.image_url.url.startsWith('file://')) {
        const filePath = part.image_url.url.slice('file://'.length);
        const buf = await fs.readFile(filePath);
        const ext = path.extname(filePath).slice(1) || 'jpeg';
        out.push({ type: 'image_url', image_url: { url: `data:image/${ext};base64,${buf.toString('base64')}` } });
      } else {
        out.push(part);
      }
    }
    return out;
  }
}
