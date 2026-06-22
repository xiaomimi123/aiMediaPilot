import { describe, expect, it } from 'vitest';
import { TOPIC_DISCOVERY } from '@/lib/llm/prompts/topic-discovery';

describe('TOPIC_DISCOVERY.buildSystemPrompt', () => {
  it('含 niche + 当前日期', () => {
    const s = TOPIC_DISCOVERY.buildSystemPrompt('ai-knowledge', '2026-06-22');
    expect(s).toContain('ai-knowledge');
    expect(s).toContain('当前日期: 2026-06-22');
    expect(s).toContain('选题策略师');
  });

  it('不传日期时不输出 当前日期 行', () => {
    const s = TOPIC_DISCOVERY.buildSystemPrompt('food');
    expect(s).toContain('food');
    expect(s).not.toContain('当前日期');
  });

  it('含 4 条方法论指引', () => {
    const s = TOPIC_DISCOVERY.buildSystemPrompt('lifestyle');
    expect(s).toContain('聚焦受众痛点');
    expect(s).toContain('不空泛');
    expect(s).toContain('钩子优先');
    expect(s).toContain('可执行');
  });

  it('含难度等级说明 (low/med/high)', () => {
    const s = TOPIC_DISCOVERY.buildSystemPrompt('ai-knowledge');
    expect(s).toContain('low:');
    expect(s).toContain('med:');
    expect(s).toContain('high:');
  });
});

describe('TOPIC_DISCOVERY.buildUserMessage', () => {
  it('基础: niche + count', () => {
    const msg = TOPIC_DISCOVERY.buildUserMessage({ niche: 'ai-knowledge', count: 12 });
    const text = (msg[0] as { text: string }).text;
    expect(text).toContain('niche: ai-knowledge');
    expect(text).toContain('12 个');
  });

  it('count 默认 12', () => {
    const msg = TOPIC_DISCOVERY.buildUserMessage({ niche: 'food' });
    const text = (msg[0] as { text: string }).text;
    expect(text).toContain('12 个');
  });

  it('有 recentTopics → 含"避免重复"段', () => {
    const msg = TOPIC_DISCOVERY.buildUserMessage({
      niche: 'ai-knowledge',
      recentTopics: ['ChatGPT 写周报', 'Claude vs GPT-4 对比', '提示词工程入门'],
    });
    const text = (msg[0] as { text: string }).text;
    expect(text).toContain('避免重复');
    expect(text).toContain('ChatGPT 写周报');
    expect(text).toContain('Claude vs GPT-4');
  });

  it('recentTopics 超过 20 条 → 截断到 20', () => {
    const topics = Array.from({ length: 30 }, (_, i) => `主题 ${i + 1}`);
    const msg = TOPIC_DISCOVERY.buildUserMessage({ niche: 'ai-knowledge', recentTopics: topics });
    const text = (msg[0] as { text: string }).text;
    expect(text).toContain('主题 20');
    expect(text).not.toContain('主题 21');
    expect(text).not.toContain('主题 30');
  });

  it('extraHint 透传', () => {
    const msg = TOPIC_DISCOVERY.buildUserMessage({
      niche: 'ai-knowledge',
      extraHint: '想要更偏新人入门',
    });
    const text = (msg[0] as { text: string }).text;
    expect(text).toContain('用户额外要求: 想要更偏新人入门');
  });

  it('无 recentTopics 时不输出 避免重复 段', () => {
    const msg = TOPIC_DISCOVERY.buildUserMessage({ niche: 'ai-knowledge' });
    const text = (msg[0] as { text: string }).text;
    expect(text).not.toContain('避免重复');
  });
});
