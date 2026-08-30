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

  // 这三条原来锁的是"文字卡片/插画风格"这两个具体措辞, 而这两处措辞正是这次要拆掉的
  // 画面封顶指令的一部分("第一版构图从简"用文字卡片举例、插画风格许诺了做不到的手绘感)。
  // 锁措辞不是这几条测试的本意——本意是锁"card/illustration 两个分支各自谈的是不同风格
  // 指引、互不串味"，所以改成断言各分支的新措辞。
  it('不传 visualStyle 时，含 card 分支的风格指引（默认分支文本不变）', () => {
    const prompt = BUILDER.buildSystemPrompt(['#111', '#eee', '#f80']);
    expect(prompt).toContain('信息画面风格');
  });

  it('显式传 visualStyle: "card" 时，含 card 分支的风格指引', () => {
    const prompt = BUILDER.buildSystemPrompt(['#111', '#eee', '#f80'], 'card');
    expect(prompt).toContain('信息画面风格');
  });

  it('传 visualStyle: "illustration" 时，含 illustration 分支的风格指引，不含 card 分支的', () => {
    const prompt = BUILDER.buildSystemPrompt(['#111', '#eee', '#f80'], 'illustration');
    expect(prompt).toContain('扁平几何风格');
    expect(prompt).not.toContain('信息画面风格');
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
