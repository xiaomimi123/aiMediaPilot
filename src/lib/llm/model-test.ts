import { z } from 'zod';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import type { ModelTestResult } from './providers';
import { explainModelError } from './errors';

const WEATHER_TOOL = { name: 'get_weather', description: '查询某个城市的天气', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] } };

/** 三项: 连通 / 工具调用(编导写稿改稿要用) / 结构化输出(拆解复盘要用) */
export async function runModelTest(m: { chat: ChatModel; llm: StructuredLLM; label: string }, now = new Date()): Promise<ModelTestResult> {
  const at = now.toISOString();
  try {
    const r = await m.chat.streamTurn([{ role: 'user', content: '只回复一个字：好' }], [], () => {});
    if (!r.text.trim()) return { at, reachable: false, tools: false, json: false, grade: 'unusable', message: `${m.label}没有回复内容。` };
  } catch (e) {
    return { at, reachable: false, tools: false, json: false, grade: 'unusable', message: explainModelError(e, m.label) };
  }
  let tools = false;
  try {
    const r = await m.chat.streamTurn(
      [
        { role: 'system', content: '需要查天气时调用 get_weather 工具。' },
        { role: 'user', content: '北京今天天气怎么样？请调用工具查询。' },
      ],
      [WEATHER_TOOL],
      () => {},
    );
    const call = r.toolCalls[0];
    tools = !!call && call.name === 'get_weather' && typeof (JSON.parse(call.arguments || '{}') as { city?: unknown }).city === 'string';
  } catch {
    tools = false;
  }
  let json = false;
  try {
    await m.llm.callStructured({ systemPrompt: '按要求输出 JSON。', userMessage: [{ type: 'text', text: '给出一个城市和它所在的国家。' }], responseSchema: z.object({ city: z.string(), country: z.string() }) });
    json = true;
  } catch {
    json = false;
  }
  if (tools && json) return { at, reachable: true, tools, json, grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。' };
  if (json) return { at, reachable: true, tools, json, grade: 'analysis_only', message: '只能做分析：不会调用工具，编导写稿改稿用不了；拆解、复盘、发布文案可以用。' };
  return { at, reachable: true, tools, json, grade: 'unusable', message: '不可用：不能按格式输出结果，拆解、复盘、发布文案都会失败。' };
}
