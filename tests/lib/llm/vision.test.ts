import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAIVisionLLM } from '@/lib/llm/vision';

const parseMock = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    beta = {
      chat: {
        completions: {
          parse: parseMock,
        },
      },
    };
  },
}));

const Schema = z.object({ rating: z.number() });

describe('OpenAIVisionLLM.callStructured', () => {
  it('成功调用 → 返回 result + usage + estCostUSD', async () => {
    parseMock.mockReset();
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { rating: 4 } } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
      model: 'gpt-4o',
    });
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-test' });
    const out = await llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'hi' }],
      responseSchema: Schema,
    });
    expect(out.result).toEqual({ rating: 4 });
    expect(out.usage.promptTokens).toBe(1000);
    expect(out.usage.completionTokens).toBe(100);
    expect(out.usage.estCostUSD).toBeGreaterThan(0);
    expect(out.usage.model).toBe('gpt-4o');
  });

  it('OpenAI 抛错 → 3 次重试后再抛', async () => {
    // Replace setTimeout with an immediate no-delay version so retry back-off
    // does not slow the test suite down by ~3 s.
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler, _delay?: number, ...args: any[]) => {
      return realSetTimeout(fn as (...args: any[]) => void, 0, ...args);
    });
    parseMock.mockReset();
    parseMock.mockRejectedValue(new Error('network'));
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-test', maxRetries: 3 });
    await expect(llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'x' }],
      responseSchema: Schema,
    })).rejects.toThrow('network');
    expect(parseMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
