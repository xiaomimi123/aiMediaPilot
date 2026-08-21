import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/video/ffmpeg', () => ({
  probeVideo: vi.fn(async () => ({ durationSec: 3.5, formatName: 'mp3' })),
}));

vi.mock('fs/promises', () => ({
  default: { writeFile: vi.fn(async () => undefined) },
}));

import { synthesizeVolcTts } from '@/lib/tts/volcengine';
import { probeVideo } from '@/lib/video/ffmpeg';
import fsPromises from 'fs/promises';

const origFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  global.fetch = origFetch;
});

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

/** 拼一段模拟的火山引擎换行分隔 JSON 流响应。 */
function streamBody(chunks: string[], opts?: { finalCode?: number; finalMessage?: string }) {
  const lines = chunks.map((c) => JSON.stringify({ code: 0, message: '', data: c }));
  lines.push(
    JSON.stringify({
      code: opts?.finalCode ?? 20000000,
      message: opts?.finalMessage ?? 'OK',
      data: null,
    })
  );
  return lines.join('\n');
}

describe('synthesizeVolcTts 参数校验', () => {
  it('缺少 apiKey → 抛出清晰错误', async () => {
    await expect(
      synthesizeVolcTts('你好', '/tmp/out.mp3', {} as any)
    ).rejects.toThrow(/apiKey/);
  });

  it('缺少文本 → 抛出清晰错误', async () => {
    await expect(
      synthesizeVolcTts('', '/tmp/out.mp3', { apiKey: 'k' })
    ).rejects.toThrow(/text/);
  });
});

describe('synthesizeVolcTts 正常响应(mock)', () => {
  it('拼接多行 base64 片段, 写入 outputPath, 返回 durationMs', async () => {
    const b64a = Buffer.from('hello-').toString('base64');
    const b64b = Buffer.from('world').toString('base64');
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers['X-Api-Key']).toBe('real-key');
      expect(init.headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
      const body = JSON.parse(init.body);
      expect(body.req_params.text).toBe('你好，这是测试。');
      expect(body.req_params.speaker).toBe('zh_female_vv_uranus_bigtts');
      return textResponse(200, streamBody([b64a, b64b]));
    });
    global.fetch = fetchMock as any;

    const result = await synthesizeVolcTts('你好，这是测试。', '/tmp/out.mp3', {
      apiKey: 'real-key',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      '/tmp/out.mp3',
      Buffer.from('hello-world')
    );
    expect(probeVideo).toHaveBeenCalledWith('/tmp/out.mp3');
    expect(result).toEqual({ audioPath: '/tmp/out.mp3', durationMs: 3500 });
  });

  it('自定义 voiceType/resourceId 会透传到请求', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers['X-Api-Resource-Id']).toBe('seed-tts-1.0');
      const body = JSON.parse(init.body);
      expect(body.req_params.speaker).toBe('zh_male_liufei_uranus_bigtts');
      return textResponse(200, streamBody([Buffer.from('abc').toString('base64')]));
    });
    global.fetch = fetchMock as any;

    await synthesizeVolcTts('测试', '/tmp/out2.mp3', {
      apiKey: 'real-key',
      voiceType: 'zh_male_liufei_uranus_bigtts',
      resourceId: 'seed-tts-1.0',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('synthesizeVolcTts 错误处理(mock)', () => {
  it('HTTP 非 2xx → 抛出包含状态码和错误信息的异常', async () => {
    const fetchMock = vi.fn(async () => textResponse(500, '{"message":"internal error"}'));
    global.fetch = fetchMock as any;

    await expect(
      synthesizeVolcTts('你好', '/tmp/out.mp3', { apiKey: 'real-key' })
    ).rejects.toThrow(/500/);
  });

  it('响应体里业务错误码(非 0/20000000) → 抛出包含错误信息的异常', async () => {
    const fetchMock = vi.fn(async () =>
      textResponse(
        200,
        streamBody([], { finalCode: 55000000, finalMessage: 'resource ID is mismatched with speaker related resource' })
      )
    );
    global.fetch = fetchMock as any;

    await expect(
      synthesizeVolcTts('你好', '/tmp/out.mp3', { apiKey: 'real-key' })
    ).rejects.toThrow(/resource ID is mismatched/);
  });

  it('响应中完全没有音频数据 → 抛出清晰错误', async () => {
    const fetchMock = vi.fn(async () => textResponse(200, streamBody([])));
    global.fetch = fetchMock as any;

    await expect(
      synthesizeVolcTts('你好', '/tmp/out.mp3', { apiKey: 'real-key' })
    ).rejects.toThrow(/未找到音频数据/);
  });
});
