import { describe, expect, it, vi } from 'vitest';
import { runModelTest } from '@/lib/llm/model-test';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-09-29T12:00:00Z');
const chat = (toolWorks: boolean): ChatModel => ({
  label: 'X',
  streamTurn: vi.fn(async (_m, tools) =>
    tools.length ? (toolWorks ? { text: '', toolCalls: [{ id: '1', name: 'get_weather', arguments: '{"city":"北京"}' }] } : { text: '北京晴', toolCalls: [] }) : { text: '好', toolCalls: [] },
  ),
});
const llm = (ok: boolean): StructuredLLM => ({ callStructured: vi.fn(async () => { if (!ok) throw new Error('bad json'); return { result: { city: '北京', country: '中国' }, usage: {} as never }; }) as never });

describe('runModelTest', () => {
  it('able_agent when all three pass', async () => {
    expect(await runModelTest({ chat: chat(true), llm: llm(true), label: 'X' }, now)).toEqual({ at: now.toISOString(), reachable: true, tools: true, json: true, grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。' });
  });
  it('analysis_only when tools fail', async () => {
    const r = await runModelTest({ chat: chat(false), llm: llm(true), label: 'X' }, now);
    expect(r).toMatchObject({ reachable: true, tools: false, json: true, grade: 'analysis_only' });
    expect(r.message).toBe('只能做分析：不会调用工具，编导写稿改稿用不了；拆解、复盘、发布文案可以用。');
  });
  it('unusable when it cannot connect', async () => {
    const down: ChatModel = { label: 'X', streamTurn: vi.fn(async () => { throw Object.assign(new Error('401'), { status: 401 }); }) };
    const r = await runModelTest({ chat: down, llm: llm(true), label: 'X' }, now);
    expect(r).toMatchObject({ reachable: false, grade: 'unusable' });
    expect(r.message).toContain('key 无效');
  });
  it('unusable when structured output fails', async () => {
    expect((await runModelTest({ chat: chat(true), llm: llm(false), label: 'X' }, now)).grade).toBe('unusable');
  });
});
