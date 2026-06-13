import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAIVisionLLM } from '@/lib/llm/vision';

const parseMock = vi.fn();
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    beta = {
      chat: {
        completions: {
          parse: parseMock,
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

  it('jsonModeFallback=true → 成功: chat.completions.create 返回 JSON, Zod 校验通过', async () => {
    createMock.mockReset();
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"rating":4}' } }],
      usage: { prompt_tokens: 500, completion_tokens: 50 },
      model: 'deepseek-chat',
    });
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-ds', jsonModeFallback: true, defaultModel: 'deepseek-chat' });
    const out = await llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'hi' }],
      responseSchema: Schema,
    });
    expect(out.result).toEqual({ rating: 4 });
    expect(out.usage.promptTokens).toBe(500);
    expect(out.usage.completionTokens).toBe(50);
    expect(out.usage.model).toBe('deepseek-chat');
    expect(createMock).toHaveBeenCalledTimes(1);
    // system prompt should contain schema hint
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('严格 JSON');
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });

  it('jsonModeFallback=true, 无效 JSON → 3 次重试后抛错', async () => {
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler, _delay?: number, ...args: any[]) => {
      return realSetTimeout(fn as (...args: any[]) => void, 0, ...args);
    });
    createMock.mockReset();
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'not valid json!!!' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
      model: 'deepseek-chat',
    });
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-ds', jsonModeFallback: true, maxRetries: 3 });
    await expect(llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'x' }],
      responseSchema: Schema,
    })).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
