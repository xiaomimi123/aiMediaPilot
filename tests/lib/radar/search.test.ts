import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TavilySearchProvider, TavilySearchError, getSearchProvider } from '@/lib/radar/search';

const origFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  global.fetch = origFetch;
  vi.useRealTimers();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('getSearchProvider', () => {
  it('返回 TavilySearchProvider 实例', () => {
    expect(getSearchProvider('tvly-xxx')).toBeInstanceOf(TavilySearchProvider);
  });
});

describe('TavilySearchProvider.search', () => {
  it('正常解析: raw_content 优先于 content, hostname 抽取正确', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) =>
      jsonResponse(200, {
        results: [
          {
            url: 'https://www.example.com/article/1',
            title: '标题一',
            content: '短摘要',
            raw_content: '完整正文',
            published_date: '2026-08-10',
          },
        ],
      })
    );
    global.fetch = fetchMock as any;

    const provider = new TavilySearchProvider('tvly-key');
    const results = await provider.search('AI 抖音', { maxResults: 5, days: 3 });

    expect(results).toEqual([
      {
        url: 'https://www.example.com/article/1',
        title: '标题一',
        content: '完整正文',
        publishedAt: '2026-08-10',
        sourceSite: 'www.example.com',
      },
    ]);

    // 鉴权走 Authorization header, body 不带明文 api_key 字段
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, any];
    expect(calledUrl).toBe('https://api.tavily.com/search');
    expect(calledInit.headers.Authorization).toBe('Bearer tvly-key');
    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody).not.toHaveProperty('api_key');
    expect(sentBody.query).toBe('AI 抖音');
    expect(sentBody.search_depth).toBe('advanced');
    expect(sentBody.include_raw_content).toBe(true);
    expect(sentBody.max_results).toBe(5);
    expect(sentBody.time_range).toBe('week'); // days=3 → 分桶到 week
  });

  it('raw_content 为 null 时回退到 content', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, {
        results: [
          { url: 'https://a.com/x', title: 'T', content: '摘要文本', raw_content: null },
        ],
      })
    ) as any;

    const provider = new TavilySearchProvider('k');
    const results = await provider.search('q');
    expect(results[0].content).toBe('摘要文本');
  });

  it('raw_content 与 content 都缺失 → content 为空字符串', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, { results: [{ url: 'https://a.com/x', title: 'T' }] })
    ) as any;

    const provider = new TavilySearchProvider('k');
    const results = await provider.search('q');
    expect(results[0].content).toBe('');
  });

  it('畸形条目 (缺 url/title) 被跳过, 不影响其余条目', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, {
        results: [
          { title: '缺 url' },
          { url: 'https://a.com/ok', title: '正常条目', content: 'c' },
          { url: 123, title: 'url 类型不对' },
          null,
          'not-an-object',
        ],
      })
    ) as any;

    const provider = new TavilySearchProvider('k');
    const results = await provider.search('q');
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://a.com/ok');
  });

  it('results 为空数组 → 返回空数组', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { results: [] })) as any;
    const provider = new TavilySearchProvider('k');
    expect(await provider.search('q')).toEqual([]);
  });

  it('响应里没有 results 字段 → 返回空数组 (不炸)', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { answer: 'x' })) as any;
    const provider = new TavilySearchProvider('k');
    expect(await provider.search('q')).toEqual([]);
  });

  it('401 → 抛 TavilySearchError, 携带 status + Tavily 的 detail.error 文案', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } })
    ) as any;

    const provider = new TavilySearchProvider('bad-key');
    await expect(provider.search('q')).rejects.toMatchObject({
      name: 'TavilySearchError',
      status: 401,
      message: 'Unauthorized: missing or invalid API key.',
    });
  });

  it('非 200 且错误体不是预期形状 → 兜底文案带 status', async () => {
    global.fetch = vi.fn(async () => jsonResponse(500, { unexpected: true })) as any;
    const provider = new TavilySearchProvider('k');
    await expect(provider.search('q')).rejects.toMatchObject({
      status: 500,
      message: 'Tavily API error (status 500)',
    });
  });

  it('超时 (>15s 未响应) → abort, 抛 TavilySearchError', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any;

    const provider = new TavilySearchProvider('k');
    const promise = provider.search('q');
    const assertion = expect(promise).rejects.toThrow(TavilySearchError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('fetch 网络错误 (非 abort) → 包装为 TavilySearchError', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;
    const provider = new TavilySearchProvider('k');
    await expect(provider.search('q')).rejects.toMatchObject({
      name: 'TavilySearchError',
      message: expect.stringContaining('network down'),
    });
  });
});
