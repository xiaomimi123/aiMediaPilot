import { describe, it, expect } from 'vitest';
import { BUILDER, BuilderResponseSchema } from '@/lib/video-production/builder-prompt';
import type { Shot } from '@/lib/video-production/director-prompt';

describe('BUILDER.buildSystemPrompt', () => {
  it('返回的字符串包含全部三个颜色值', () => {
    const prompt = BUILDER.buildSystemPrompt(['#111', '#eee', '#f80']);
    expect(prompt).toContain('#111');
    expect(prompt).toContain('#eee');
    expect(prompt).toContain('#f80');
  });

  it('含"window.__timelines"关键字符串', () => {
    const prompt = BUILDER.buildSystemPrompt(['#111', '#eee', '#f80']);
    expect(prompt).toContain('window.__timelines');
  });
});

describe('BUILDER.buildUserMessage', () => {
  const shot: Shot = {
    shotId: 'shot-1',
    startMs: 0,
    endMs: 4000,
    claim: '这是一个测试主张',
    visualJob: 'clarify',
    beats: [
      { visibleState: '标题出现', development: '淡入' },
      { visibleState: '标题居中', development: '定格' },
      { visibleState: '标题高亮', development: '强调关键词' },
    ],
  };

  it('返回的 text 含镜头的 claim 原文、含正确计算出的秒数', () => {
    const parts = BUILDER.buildUserMessage(shot);
    expect(parts[0].type).toBe('text');
    const text = (parts[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('这是一个测试主张');
    expect(text).toContain('4');
  });

  it('对多个 beats 的镜头，每个 beat 的 visibleState/development 都出现在文本里', () => {
    const parts = BUILDER.buildUserMessage(shot);
    const text = (parts[0] as { type: 'text'; text: string }).text;
    for (const beat of shot.beats) {
      expect(text).toContain(beat.visibleState);
      expect(text).toContain(beat.development);
    }
  });
});

describe('BuilderResponseSchema', () => {
  it('正例: {html: "<!DOCTYPE html>..."} 通过', () => {
    const result = BuilderResponseSchema.safeParse({ html: '<!DOCTYPE html>...' });
    expect(result.success).toBe(true);
  });

  it('反例: html 空字符串被拒', () => {
    const result = BuilderResponseSchema.safeParse({ html: '' });
    expect(result.success).toBe(false);
  });

  it('反例: html 字段缺失被拒', () => {
    const result = BuilderResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
