import { z } from 'zod';

/**
 * 小红书配图 — gpt-image-1 生图 provider。
 *
 * OpenAI Images API (`POST /v1/images/generations`)：gpt-image-1 模型固定返回
 * `b64_json`（不支持 `response_format: 'url'`，也不需要传 `response_format` 字段——
 * 传了在部分官方 SDK/文档版本会被直接拒绝，故本实现不传该字段，与旧版 dall-e-3 的
 * url/b64 二选一行为不同）。
 *
 * base URL **硬编码**为 `https://api.openai.com/v1`，不读任何环境变量
 * (`OPENAI_BASE_URL` 等)——生图走官方端点，不支持自定义网关。
 *
 * 错误信息/日志绝不包含 API key：失败时只把 OpenAI 返回的 `error.message`（或
 * 兜底的 status 文案）透传给调用方，Authorization header 里的 key 本身从不进入
 * 任何 throw/log。
 */

export interface ImageGenOpts {
  prompt: string;
  size: '1024x1536';
  quality: 'low' | 'medium' | 'high';
}

export interface ImageProvider {
  generate(opts: ImageGenOpts): Promise<Buffer>;
}

const IMAGE_GEN_URL = 'https://api.openai.com/v1/images/generations';
const TIMEOUT_MS = 120_000;

// 防御 zod: 只窄化消费所需的最小形状，其余字段一律 passthrough 忽略。
const ImageGenResponseSchema = z
  .object({
    data: z.array(z.object({ b64_json: z.string() }).passthrough()).min(1),
  })
  .passthrough();

const ImageGenErrorBodySchema = z
  .object({
    error: z
      .object({ message: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const raw = await res.json();
    const parsed = ImageGenErrorBodySchema.safeParse(raw);
    if (parsed.success && parsed.data.error?.message) {
      return parsed.data.error.message;
    }
  } catch {
    // body 不是 JSON 或读取失败, 落到下面的默认文案
  }
  return `gpt-image-1 生图请求失败 (status ${res.status})`;
}

export class GptImageProvider implements ImageProvider {
  constructor(private apiKey: string) {}

  async generate(opts: ImageGenOpts): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(IMAGE_GEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: opts.prompt,
          size: opts.size,
          quality: opts.quality,
          n: 1,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`gpt-image-1 生图请求超时 (${TIMEOUT_MS / 1000}s)`);
      }
      throw new Error(
        `gpt-image-1 生图请求失败: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const message = await extractErrorMessage(res);
      throw new Error(message);
    }

    const json = await res.json().catch(() => null);
    const parsed = ImageGenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('gpt-image-1 生图响应格式异常');
    }

    return Buffer.from(parsed.data.data[0].b64_json, 'base64');
  }
}

/** 工厂函数 — 目前仅 gpt-image-1 一家, 预留未来接入其他生图源的扩展点。 */
export function getImageProvider(apiKey: string): ImageProvider {
  return new GptImageProvider(apiKey);
}
