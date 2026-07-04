import { DeepSeekTextLLM } from './deepseek';
import { OpenAIVisionLLM } from './vision';

/**
 * LLM 客户端模块级 singleton。
 *
 * 之前的问题: 每个 API 请求都 `new DeepSeekTextLLM({ apiKey })`, 底层每次都
 * `new OpenAI(...)`, keep-alive agent / connection pool 无法复用, 也无谓 GC 压力。
 *
 * cache key = (baseURL, apiKey, defaultModel, jsonModeFallback) 组合。
 * apiKey 变了(比如运维旋转)自动重建, 不需要重启进程。
 */

interface OpenAICacheKey {
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  jsonModeFallback: boolean;
}

const openaiCache = new Map<string, OpenAIVisionLLM>();
const deepseekCache = new Map<string, DeepSeekTextLLM>();

function keyFor(k: OpenAICacheKey): string {
  return `${k.baseURL ?? ''}|${k.apiKey}|${k.defaultModel}|${k.jsonModeFallback ? 1 : 0}`;
}

export interface GetOpenAIVisionLLMOpts {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  jsonModeFallback?: boolean;
}

export function getOpenAIVisionLLM(opts: GetOpenAIVisionLLMOpts): OpenAIVisionLLM {
  const k: OpenAICacheKey = {
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    defaultModel: opts.defaultModel ?? 'gpt-4o',
    jsonModeFallback: opts.jsonModeFallback ?? false,
  };
  const cacheKey = keyFor(k);
  let inst = openaiCache.get(cacheKey);
  if (!inst) {
    inst = new OpenAIVisionLLM({
      apiKey: k.apiKey,
      baseURL: k.baseURL,
      defaultModel: k.defaultModel,
      jsonModeFallback: k.jsonModeFallback,
    });
    openaiCache.set(cacheKey, inst);
  }
  return inst;
}

export function getDeepSeekTextLLM(apiKey: string): DeepSeekTextLLM {
  let inst = deepseekCache.get(apiKey);
  if (!inst) {
    inst = new DeepSeekTextLLM({ apiKey });
    deepseekCache.set(apiKey, inst);
  }
  return inst;
}

/** 测试用 — 清缓存, 保证 test isolation。 */
export function __resetLLMClientsForTest(): void {
  openaiCache.clear();
  deepseekCache.clear();
}
