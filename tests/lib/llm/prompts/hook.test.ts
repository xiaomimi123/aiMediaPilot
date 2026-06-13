import { describe, expect, it } from 'vitest';
import { HOOK, HookResponseSchema } from '@/lib/llm/prompts/hook';

describe('HOOK', () => {
  it('buildSystemPrompt 含专家人设关键词 (ai-knowledge)', () => {
    const sys = HOOK.buildSystemPrompt('ai-knowledge');
    expect(sys).toMatch(/AI 知识/);
    expect(sys).toMatch(/钩子|前 3 秒/);
  });

  it('buildSystemPrompt("ai-knowledge") 含 "AI 知识"', () => {
    expect(HOOK.buildSystemPrompt('ai-knowledge')).toContain('AI 知识');
  });

  it('buildSystemPrompt("健身") 含 "健身" (custom niche injection)', () => {
    expect(HOOK.buildSystemPrompt('健身')).toContain('健身');
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
