import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { promises as fs } from 'fs';
import path from 'path';
import type { z, ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
  model?: string;
  maxTokens?: number;
}

export interface IVisionLLM {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }>;
}

export interface OpenAIVisionLLMOpts {
  apiKey: string;
  baseURL?: string;
  jsonModeFallback?: boolean;
  maxRetries?: number;
  defaultModel?: string;
}

export class OpenAIVisionLLM implements IVisionLLM {
  private client: OpenAI;
  private maxRetries: number;
  private defaultModel: string;
  private jsonModeFallback: boolean;

  constructor(opts: OpenAIVisionLLMOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
    this.maxRetries = opts.maxRetries ?? 3;
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
    this.jsonModeFallback = opts.jsonModeFallback ?? false;
  }

  async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
    if (this.jsonModeFallback) {
      return this.callViaJsonMode(opts);
    }
    return this.callViaBetaParse(opts);
  }

  private async callViaBetaParse<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
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
        // 非 5xx 的 OpenAI APIError 通常是配置/请求错 (401 wrong key, 400 bad req),
        // 重试无意义,直接抛
        const e = err as { status?: number };
        if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        }
      }
    }
    throw lastError;
  }

  private async callViaJsonMode<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
    const model = opts.model ?? this.defaultModel;
    const userMessage = await this.encodeFileImages(opts.userMessage);

    // 把 Zod schema 转 JSON Schema 注入 system prompt，DeepSeek/兼容 API 才知道精确字段
    const jsonSchema = zodToJsonSchema(opts.responseSchema as ZodSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    });
    const schemaJson = JSON.stringify(jsonSchema, null, 2);
    if (schemaJson.length > 5000) {
      console.warn(`[VisionLLM] JSON Schema hint is large (${schemaJson.length} bytes) — this will bloat every prompt`);
    }
    const schemaHint = `

输出必须严格符合以下 JSON Schema (注意字段名大小写、必填项、enum 取值):
\`\`\`json
${schemaJson}
\`\`\`

只输出 JSON 对象本体, 不要 markdown 代码块标记, 不要解释文字。`;
    const finalSystem = opts.systemPrompt + schemaHint;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: finalSystem },
            { role: 'user', content: userMessage as any },
          ],
          response_format: { type: 'json_object' },
          max_tokens: opts.maxTokens,
        });
        if (!completion.choices || completion.choices.length === 0) {
          throw new Error('LLM 返回空 choices (可能触发 content filter 或 API 错误)');
        }
        const content = completion.choices[0]?.message.content ?? '';
        if (!content.trim()) {
          throw new Error(`LLM 返回空内容 (finish_reason=${completion.choices[0]?.finish_reason ?? 'unknown'})`);
        }
        const parsed = JSON.parse(content) as unknown;
        const result = opts.responseSchema.parse(parsed) as T;
        const usage = completion.usage;
        return {
          result,
          usage: {
            model: completion.model ?? model,
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            estCostUSD: estimateCostUSD(model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
          },
        };
      } catch (err) {
        lastError = err;
        // 非 5xx 的 OpenAI APIError 通常是配置/请求错 (401 wrong key, 400 bad req),
        // 重试无意义,直接抛
        const e = err as { status?: number };
        if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
          throw err;
        }
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
