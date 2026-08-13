import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GptImageProvider, getImageProvider } from '@/lib/image/provider';

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

describe('getImageProvider', () => {
  it('返回 GptImageProvider 实例', () => {
    expect(getImageProvider('sk-xxx')).toBeInstanceOf(GptImageProvider);
  });
});

describe('GptImageProvider.generate', () => {
  it('成功: b64_json → Buffer 往返, 请求体正确 (不传 response_format)', async () => {
    const b64 = Buffer.from('fake-png-bytes').toString('base64');
    const fetchMock = vi.fn(async (_url: string, _init: any) =>
      jsonResponse(200, { data: [{ b64_json: b64 }] })
    );
    global.fetch = fetchMock as any;

    const provider = new GptImageProvider('sk-secret-key');
    const buf = await provider.generate({ prompt: '一只猫', size: '1024x1536', quality: 'medium' });

    expect(buf).toEqual(Buffer.from('fake-png-bytes'));

    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init.headers.Authorization).toBe('Bearer sk-secret-key');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'gpt-image-1',
      prompt: '一只猫',
      size: '1024x1536',
      quality: 'medium',
      n: 1,
    });
    expect(body).not.toHaveProperty('response_format');
  });

  it('401 → 抛错, 文案不含 key', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(401, { error: { message: 'Incorrect API key provided' } })
    ) as any;

    const provider = new GptImageProvider('sk-secret-key-should-not-leak');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toThrow('Incorrect API key provided');

    try {
      await provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('sk-secret-key-should-not-leak');
    }
  });

  it('非 200 且错误体不是预期形状 → 兜底文案带 status', async () => {
    global.fetch = vi.fn(async () => jsonResponse(500, { unexpected: true })) as any;
    const provider = new GptImageProvider('sk-key');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toMatchObject({ message: expect.stringContaining('500') });
  });

  it('超时 (>120s 未响应) → abort, 抛错', async () => {
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

    const provider = new GptImageProvider('sk-key');
    const promise = provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' });
    const assertion = expect(promise).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });

  it('fetch 网络错误 (非 abort) → 包装抛错', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;
    const provider = new GptImageProvider('sk-key');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toMatchObject({ message: expect.stringContaining('network down') });
  });

  it('畸形响应 (data[0] 缺 b64_json) → 抛错', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { data: [{}] })) as any;
    const provider = new GptImageProvider('sk-key');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toThrow();
  });

  it('畸形响应 (data 为空数组) → 抛错', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { data: [] })) as any;
    const provider = new GptImageProvider('sk-key');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toThrow();
  });

  it('畸形响应 (缺 data 字段) → 抛错', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { foo: 'bar' })) as any;
    const provider = new GptImageProvider('sk-key');
    await expect(
      provider.generate({ prompt: 'x', size: '1024x1536', quality: 'low' })
    ).rejects.toThrow();
  });
});
