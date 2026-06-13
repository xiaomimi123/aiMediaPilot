import { describe, expect, it } from 'vitest';
import { RETENTION, RetentionResponseSchema } from '@/lib/llm/prompts/retention';

describe('RETENTION', () => {
  it('buildSystemPrompt("ai-knowledge") 含 "AI 知识"', () => {
    expect(RETENTION.buildSystemPrompt('ai-knowledge')).toContain('AI 知识');
  });

  it('buildSystemPrompt("娱乐") 含 "娱乐" (custom niche injection)', () => {
    expect(RETENTION.buildSystemPrompt('娱乐')).toContain('娱乐');
  });

  it('buildUserMessage 含全段 transcript 时间戳 + 多张帧', () => {
    const parts = RETENTION.buildUserMessage({
      durationSec: 90,
      frameImagePaths: ['/a.jpg', '/b.jpg', '/c.jpg'],
      transcriptSegments: [
        { startSec: 0, endSec: 5, text: 'hello' },
        { startSec: 5, endSec: 10, text: 'world' },
      ],
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/0\.00-5\.00/);
    expect(text).toMatch(/hello/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
  });
});

describe('RetentionResponseSchema', () => {
  it('合法响应通过', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [{ startSec: 18, endSec: 24, severity: 'high', reason: 'x', suggestion: 'y' }],
      overallSummary: '整体可看',
    })).not.toThrow();
  });

  it('severity 必须是 low/medium/high', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [{ startSec: 0, endSec: 1, severity: 'meh', reason: '', suggestion: '' }],
      overallSummary: '',
    })).toThrow();
  });

  it('riskPoints 为空数组合法 (视频很流畅)', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [],
      overallSummary: '流畅',
    })).not.toThrow();
  });
});
