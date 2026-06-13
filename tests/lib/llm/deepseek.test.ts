import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    beta = {
      chat: {
        completions: {
          parse: vi.fn(),
        },
      },
    };
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

import { DeepSeekTextLLM } from '@/lib/llm/deepseek';

const Schema = z.object({ score: z.number() });

describe('DeepSeekTextLLM', () => {
  it('实例化: 默认 model=deepseek-chat, jsonModeFallback=true', async () => {
    createMock.mockReset();
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"score":8}' } }],
      usage: { prompt_tokens: 200, completion_tokens: 30 },
      model: 'deepseek-chat',
    });
    const llm = new DeepSeekTextLLM({ apiKey: 'sk-ds-test' });
    const out = await llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'hi' }],
      responseSchema: Schema,
    });
    expect(out.result).toEqual({ score: 8 });
    expect(out.usage.model).toBe('deepseek-chat');
    // Verify json_object mode was used (not beta.parse)
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });

  it('含 image_url parts → 抛错, 不调 API', async () => {
    createMock.mockReset();
    const llm = new DeepSeekTextLLM({ apiKey: 'sk-ds-test' });
    await expect(
      llm.callStructured({
        systemPrompt: 'sys',
        userMessage: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
        ],
        responseSchema: Schema,
      })
    ).rejects.toThrow('DeepSeekTextLLM 不支持视觉调用');
    expect(createMock).not.toHaveBeenCalled();
  });
});
