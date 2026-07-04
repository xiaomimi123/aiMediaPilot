import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/prompts/expert-persona', () => ({
  KNOWN_NICHES: [
    { key: 'ai-knowledge', label: 'AI 知识' },
    { key: 'fitness', label: '健身' },
  ],
}));

import { normalizeNiche } from '@/lib/niche';

describe('normalizeNiche', () => {
  it('已知 key 保留原样', () => {
    expect(normalizeNiche('ai-knowledge')).toBe('ai-knowledge');
  });

  it('大小写不敏感 匹配 key', () => {
    expect(normalizeNiche('AI-Knowledge')).toBe('ai-knowledge');
    expect(normalizeNiche('  AI-KNOWLEDGE  ')).toBe('ai-knowledge');
  });

  it('label 匹配 → 反查 key', () => {
    expect(normalizeNiche('AI 知识')).toBe('ai-knowledge');
    expect(normalizeNiche('健身')).toBe('fitness');
  });

  it('折叠多余空白', () => {
    expect(normalizeNiche('  多空格   \t niche  ')).toBe('多空格 niche');
  });

  it('未知 niche → 归一化 (trim + lowercase + collapse space)', () => {
    expect(normalizeNiche('  Random Custom Niche ')).toBe('random custom niche');
  });

  it('空/纯空白 → 空串', () => {
    expect(normalizeNiche('')).toBe('');
    expect(normalizeNiche('   ')).toBe('');
  });
});
