import { z } from 'zod';

/**
 * 热点雷达 — 搜索层。
 *
 * Tavily 请求/响应形状取自官方文档 (2026-08-13 用 WebFetch 核对
 * https://docs.tavily.com/documentation/api-reference/endpoint/search，
 * 与 https://docs.tavily.com/api-reference/endpoint/search 交叉确认一致):
 * - 鉴权走 `Authorization: Bearer <api_key>` header，**不是**请求体里的 `api_key` 字段
 *   (早期/非官方示例常见 body.api_key，现行文档已不支持，故不采用)。
 * - 不存在 `days` 参数；近期过滤走 `time_range: 'day'|'week'|'month'|'year'`。
 *   本模块对外仍保留 `opts.days`（brief 约定的接口形状，供 T4 调用方使用），
 *   内部按天数分桶换算成 `time_range`。
 * - 响应 `results[]` 字段: `title` / `url` / `content` / `raw_content`(仅
 *   `include_raw_content` 为真时可能出现，抽取失败时可能为 null) / `score` /
 *   `favicon` / `images` / `id`。文档未列出 `published_date`，但部分
 *   news-topic 查询实测会带这个字段 —— schema 里按可选字段处理，没有就不填。
 */

export type SearchResult = {
  url: string;
  title: string;
  content: string;
  publishedAt?: string;
  sourceSite: string;
};

export interface SearchProvider {
  search(query: string, opts?: { maxResults?: number; days?: number }): Promise<SearchResult[]>;
}

/** Tavily 搜索请求失败时抛出的类型化错误 — 携带 HTTP status 便于调用方分支处理 (如 401 提示重新配 key)。 */
export class TavilySearchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TavilySearchError';
    this.status = status;
  }
}

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TIMEOUT_MS = 15_000;

// 宽松 schema: 只校验 SearchResult 必需的字段 (url/title)，其余任意多余字段一律 passthrough 忽略。
// 单条解析失败 (缺 url/title 等) 时跳过该条，不让整批请求因为一条脏数据而报废。
const TavilyResultSchema = z
  .object({
    url: z.string().min(1),
    title: z.string().min(1),
    content: z.string().optional(),
    raw_content: z.string().nullable().optional(),
    published_date: z.string().optional(),
  })
  .passthrough();

const TavilyResponseSchema = z
  .object({
    results: z.array(z.unknown()).optional(),
  })
  .passthrough();

const TavilyErrorBodySchema = z
  .object({
    detail: z
      .union([z.string(), z.object({ error: z.string().optional() }).passthrough()])
      .optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

function daysToTimeRange(days?: number): 'day' | 'week' | 'month' | 'year' | undefined {
  if (days === undefined) return undefined;
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'year';
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const raw = await res.json();
    const parsed = TavilyErrorBodySchema.safeParse(raw);
    if (parsed.success) {
      const { detail, error, message } = parsed.data;
      if (typeof detail === 'string') return detail;
      if (detail && typeof detail === 'object' && detail.error) return detail.error;
      if (error) return error;
      if (message) return message;
    }
  } catch {
    // body 不是 JSON 或读取失败, 落到下面的默认文案
  }
  return `Tavily API error (status ${res.status})`;
}

export class TavilySearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    opts: { maxResults?: number; days?: number } = {}
  ): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'advanced',
          include_raw_content: true,
          topic: 'news',
          max_results: opts.maxResults ?? 10,
          ...(daysToTimeRange(opts.days) ? { time_range: daysToTimeRange(opts.days) } : {}),
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new TavilySearchError(`Tavily 请求超时 (${TIMEOUT_MS / 1000}s)`);
      }
      throw new TavilySearchError(
        `Tavily 请求失败: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const message = await extractErrorMessage(res);
      throw new TavilySearchError(message, res.status);
    }

    const json = await res.json().catch(() => null);
    const parsed = TavilyResponseSchema.safeParse(json);
    if (!parsed.success || !parsed.data.results) return [];

    const out: SearchResult[] = [];
    for (const rawItem of parsed.data.results) {
      const item = TavilyResultSchema.safeParse(rawItem);
      if (!item.success) continue; // 跳过畸形条目, 不让整批因一条脏数据而炸

      let sourceSite: string;
      try {
        sourceSite = new URL(item.data.url).hostname;
      } catch {
        continue; // url 不是合法 URL, 一并跳过
      }

      out.push({
        url: item.data.url,
        title: item.data.title,
        content: item.data.raw_content ?? item.data.content ?? '',
        ...(item.data.published_date ? { publishedAt: item.data.published_date } : {}),
        sourceSite,
      });
    }
    return out;
  }
}

/** 工厂函数 — 目前仅 Tavily 一家, 预留未来接入其他搜索源的扩展点。 */
export function getSearchProvider(apiKey: string): SearchProvider {
  return new TavilySearchProvider(apiKey);
}
