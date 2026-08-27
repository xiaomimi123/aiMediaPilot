import { describe, it, expect } from 'vitest';
import {
  SCRIPT_SOFT_SCORE,
  SOFT_DIMENSION_META,
  SOFT_MAX,
  toSoftDimensions,
} from '@/lib/llm/prompts/script-soft-score';

const ACTS = [
  { act: 'hook', title: '钩子', narration: '我靠给别人装一个开源项目赚到了第一笔钱。', targetSec: 10 },
  { act: 'punchline', title: '收尾', narration: '别猜，去测。', targetSec: 8 },
];

describe('SCRIPT_SOFT_SCORE', () => {
  it('五个软维度加起来 65 分', () => {
    const sum = SOFT_DIMENSION_META.reduce((s, d) => s + d.max, 0);
    expect(sum).toBe(SOFT_MAX);
    expect(SOFT_MAX).toBe(65);
  });

  it('硬软两层合起来正好 100 分', async () => {
    const { HARD_MAX } = await import('@/lib/cockpit/script-score');
    expect(HARD_MAX + SOFT_MAX).toBe(100);
  });

  it('user message 带上每一幕的台词和时长', () => {
    const parts = SCRIPT_SOFT_SCORE.buildUserMessage({ acts: ACTS });
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('\n');
    expect(text).toContain('我靠给别人装一个开源项目赚到了第一笔钱。');
    expect(text).toContain('别猜，去测。');
    expect(text).toContain('hook');
    expect(text).toContain('10');
  });

  it('system prompt 写明每个维度的满分, 且把评分依据的两条爆款结构说出来', () => {
    const sys = SCRIPT_SOFT_SCORE.buildSystemPrompt('ai-knowledge');
    for (const d of SOFT_DIMENSION_META) {
      expect(sys).toContain(d.key);
      expect(sys).toContain(String(d.max));
    }
    expect(sys).toMatch(/失败|试错/);
  });

  it('输出契约在 system prompt 的最后 —— 前面加的约束不能把它挤走', () => {
    const sys = SCRIPT_SOFT_SCORE.buildSystemPrompt('ai-knowledge');
    const contractAt = sys.lastIndexOf('JSON');
    expect(contractAt).toBeGreaterThan(sys.length * 0.7);
  });

  it('schema 拒绝超出满分的打分', () => {
    const bad = {
      hookPower: { score: 25, reason: '超了' },
      failureNarrative: { score: 10, reason: 'ok' },
      pivotClarity: { score: 8, reason: 'ok' },
      resultCredibility: { score: 8, reason: 'ok' },
      punchline: { score: 8, reason: 'ok' },
      topFixes: ['补一句信任声明'],
    };
    expect(SCRIPT_SOFT_SCORE.responseSchema.safeParse(bad).success).toBe(false);
  });

  it('schema 接受合法打分', () => {
    const good = {
      hookPower: { score: 15, reason: '开头有结果也有悬念' },
      failureNarrative: { score: 8, reason: '踩坑一笔带过' },
      pivotClarity: { score: 10, reason: '转折干净' },
      resultCredibility: { score: 10, reason: '有验证动作' },
      punchline: { score: 8, reason: '收得住' },
      topFixes: ['把踩坑展开成一个具体的坑'],
    };
    const parsed = SCRIPT_SOFT_SCORE.responseSchema.safeParse(good);
    expect(parsed.success).toBe(true);
  });
});

describe('toSoftDimensions', () => {
  it('把模型返回摊平成和硬指标同形状的维度数组', () => {
    const dims = toSoftDimensions({
      hookPower: { score: 15, reason: 'a' },
      failureNarrative: { score: 8, reason: 'b' },
      pivotClarity: { score: 10, reason: 'c' },
      resultCredibility: { score: 10, reason: 'd' },
      punchline: { score: 8, reason: 'e' },
      topFixes: [],
    });
    expect(dims).toHaveLength(5);
    expect(dims[0]).toMatchObject({ key: 'hookPower', max: 20, score: 15, reason: 'a' });
    expect(dims.every((d) => typeof d.label === 'string' && d.label.length > 0)).toBe(true);
    expect(dims.reduce((s, d) => s + d.score, 0)).toBe(51);
  });
});
