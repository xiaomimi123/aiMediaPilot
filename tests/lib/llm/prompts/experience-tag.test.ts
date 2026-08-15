import { describe, expect, it } from 'vitest';
import { EXPERIENCE_TAG, ExperienceTagSchema } from '@/lib/llm/prompts/experience-tag';

describe('ExperienceTagSchema', () => {
  const base = { topic: 'AI 配图', kind: 'failure' as const, keywords: ['a', 'b', 'c'] };

  it('基础形状通过', () => {
    expect(ExperienceTagSchema.safeParse(base).success).toBe(true);
  });

  it('topic 20 过 / 21 拒 / 空拒', () => {
    expect(ExperienceTagSchema.safeParse({ ...base, topic: 'a'.repeat(20) }).success).toBe(true);
    expect(ExperienceTagSchema.safeParse({ ...base, topic: 'a'.repeat(21) }).success).toBe(false);
    expect(ExperienceTagSchema.safeParse({ ...base, topic: '' }).success).toBe(false);
  });

  it('kind 必须是四个枚举之一', () => {
    for (const k of ['practice', 'failure', 'insight', 'result']) {
      expect(ExperienceTagSchema.safeParse({ ...base, kind: k }).success).toBe(true);
    }
    expect(ExperienceTagSchema.safeParse({ ...base, kind: 'other' }).success).toBe(false);
  });

  it('keywords 3-5 个, 每个 ≤12 字', () => {
    expect(ExperienceTagSchema.safeParse({ ...base, keywords: ['a', 'b'] }).success).toBe(false);
    expect(
      ExperienceTagSchema.safeParse({ ...base, keywords: ['a', 'b', 'c', 'd', 'e'] }).success,
    ).toBe(true);
    expect(
      ExperienceTagSchema.safeParse({ ...base, keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }).success,
    ).toBe(false);
    expect(
      ExperienceTagSchema.safeParse({ ...base, keywords: ['a'.repeat(13), 'b', 'c'] }).success,
    ).toBe(false);
  });
});

describe('EXPERIENCE_TAG.buildSystemPrompt', () => {
  const sys = EXPERIENCE_TAG.buildSystemPrompt('ai-knowledge');
  const taskBody = sys.slice(sys.indexOf('任务:'));

  it('明确禁止改写/润色原文(原话是经历库的价值本身)', () => {
    expect(taskBody).toContain('不要改写');
    expect(taskBody).toContain('不要润色');
  });

  it('四种 kind 各有中文释义', () => {
    for (const label of ['实践', '翻车', '认知刷新', '成果']) {
      expect(taskBody).toContain(label);
    }
  });

  it('keywords 给了好例与坏例, 要求检索词而非摘要词', () => {
    expect(taskBody).toContain('好例');
    expect(taskBody).toContain('坏例');
    expect(taskBody).toContain('检索价值');
  });
});

describe('EXPERIENCE_TAG.buildUserMessage', () => {
  it('原文原样进 prompt', () => {
    const parts = EXPERIENCE_TAG.buildUserMessage({ content: '我今天翻车了' });
    expect(parts[0].type).toBe('text');
    expect((parts[0] as { text: string }).text).toContain('我今天翻车了');
  });
});
