import { describe, expect, it } from 'vitest';
import { formatAssistantPrompt } from '@/lib/assistant/context';

describe('formatAssistantPrompt', () => {
  it('includes rules, persona, status, lessons and the skill list', () => {
    const p = formatAssistantPrompt({ persona: '定位摘要：真实是差异化', status: '粉丝 408', lessons: '- 第一句直接说结果（1 条作品）', skills: [{ name: 'daily-kickoff', description: '每日开工' }] });
    expect(p).toContain('你是用户的抖音创作总助手');
    expect(p).toContain('出片要在 Claude Code 里做');
    expect(p).toContain('【账号定位】\n定位摘要：真实是差异化');
    expect(p).toContain('【账号概况】\n粉丝 408');
    expect(p).toContain('【写法经验】\n- 第一句直接说结果（1 条作品）');
    expect(p).toContain('【可用 skill】（做这类事前先 load_skill）\n- daily-kickoff：每日开工');
    expect(p).toContain('/projects/<id>');
    expect(p).toContain('不用 Markdown');
  });
  it('omits empty sections', () => {
    const p = formatAssistantPrompt({ persona: '', status: '粉丝 408', lessons: '', skills: [] });
    expect(p).not.toContain('【账号定位】');
    expect(p).not.toContain('【写法经验】');
  });
});
