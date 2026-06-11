import { describe, expect, it } from 'vitest';
import { HOOK, HookResponseSchema } from '@/lib/llm/prompts/ai-knowledge/hook';

describe('HOOK', () => {
  it('systemPrompt 含专家人设关键词', () => {
    expect(HOOK.systemPrompt).toMatch(/AI 知识类/);
    expect(HOOK.systemPrompt).toMatch(/钩子|前 3 秒/);
  });

  it('buildUserMessage 构造文本 + 图片', () => {
    const parts = HOOK.buildUserMessage({
      durationSec: 45,
      frameImagePaths: ['/tmp/a.jpg', '/tmp/b.jpg'],
      transcript03s: '今天讲讲 LLM',
    });
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as any).text).toMatch(/45/);
    expect((parts[0] as any).text).toMatch(/今天讲讲 LLM/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
  });

  it('transcript 为空时显示 (无语音) 占位', () => {
    const parts = HOOK.buildUserMessage({
      durationSec: 30,
      frameImagePaths: ['/tmp/a.jpg'],
      transcript03s: '',
    });
    expect((parts[0] as any).text).toMatch(/无语音/);
  });
});

describe('HookResponseSchema', () => {
  it('接受合法响应', () => {
    const data = {
      rating: 3,
      summary: '钩子一般',
      suggestions: ['加反差'],
      keyObservations: [{ timestampSec: 0.5, note: '镜头静态' }],
    };
    expect(() => HookResponseSchema.parse(data)).not.toThrow();
  });

  it('rating 超出 1-5 被拒', () => {
    expect(() =>
      HookResponseSchema.parse({ rating: 7, summary: '', suggestions: [], keyObservations: [] })
    ).toThrow();
  });

  it('suggestions 为空数组被拒', () => {
    expect(() =>
      HookResponseSchema.parse({ rating: 3, summary: 'x', suggestions: [], keyObservations: [] })
    ).toThrow();
  });
});
