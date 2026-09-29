import { describe, expect, it } from 'vitest';
import { explainModelError } from '@/lib/llm/errors';

const L = 'Kimi（moonshot-v1-8k）';
const withStatus = (status: number, message = 'x') => Object.assign(new Error(message), { status });

describe('explainModelError', () => {
  it('maps common failures to Chinese with the model name', () => {
    expect(explainModelError(withStatus(401), L)).toBe('Kimi（moonshot-v1-8k）拒绝了请求：key 无效或没有权限，去设置页检查这个模型的 key。');
    expect(explainModelError(withStatus(402), L)).toContain('余额不足');
    expect(explainModelError(withStatus(429), L)).toContain('请求太频繁或额度用完');
    expect(explainModelError(withStatus(404), L)).toContain('模型名不对或接口地址不对');
    expect(explainModelError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }), 'Ollama（qwen2.5）')).toBe('连不上本地模型 Ollama（qwen2.5）：先运行 Ollama，再重试。');
    expect(explainModelError(new Error('getaddrinfo ENOTFOUND api.x.com'), L)).toContain('连不上 Kimi（moonshot-v1-8k）：检查网络和接口地址');
  });
  it('recognizes status text inside plain messages', () => {
    expect(explainModelError(new Error('401 Unauthorized'), L)).toContain('key 无效');
  });
  it('falls back to a short message', () => {
    expect(explainModelError(new Error('something odd'), L)).toBe('Kimi（moonshot-v1-8k）出错了：something odd');
  });
});
