import { describe, expect, it } from 'vitest';
import { formatStyleHints } from '@/lib/llm/prompts/style-hints';

describe('formatStyleHints', () => {
  it('undefined → 空字符串', () => {
    expect(formatStyleHints(undefined)).toBe('');
  });

  it('全空字段 → 空字符串', () => {
    expect(formatStyleHints({})).toBe('');
    expect(formatStyleHints({ hookTypes: [], titlePatterns: [], durationInsight: '' })).toBe('');
  });

  it('只有 hookTypes → 不带 title/duration 行', () => {
    const s = formatStyleHints({ hookTypes: ['数字', '反差'] });
    expect(s).toContain('钩子类型: 数字 / 反差');
    expect(s).not.toContain('标题模式');
    expect(s).not.toContain('时长规律');
  });

  it('全字段都有 → 全展开', () => {
    const s = formatStyleHints({
      hookTypes: ['数字', '反差', '悬念'],
      titlePatterns: ['以数字开头', '含 emoji'],
      durationInsight: '45-60s 最优',
    });
    expect(s).toContain('钩子类型: 数字 / 反差 / 悬念');
    expect(s).toContain('标题模式: 以数字开头 / 含 emoji');
    expect(s).toContain('时长规律: 45-60s 最优');
    expect(s).toContain('参考下面对标爆款的共性');
  });

  it('hookTypes 超过 5 个 → 截断', () => {
    const s = formatStyleHints({
      hookTypes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    expect(s).toContain('a / b / c / d / e');
    expect(s).not.toContain(' / f');
  });

  it('titlePatterns 超过 5 → 截断', () => {
    const s = formatStyleHints({
      titlePatterns: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    });
    expect(s).toContain('p1 / p2 / p3 / p4 / p5');
    expect(s).not.toContain('p6');
  });
});
