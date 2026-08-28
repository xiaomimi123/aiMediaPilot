import { describe, it, expect } from 'vitest';
import { stripScaffold } from '@/lib/llm/prompts/script-import';

describe('stripScaffold', () => {
  it('去掉【0-4秒】这类时间标记', () => {
    expect(stripScaffold('【0-4秒】我卡了两天。')).toBe('我卡了两天。');
  });

  it('去掉【开场钩子】这类段落标签', () => {
    expect(stripScaffold('【开场钩子】\n我卡了两天。')).toContain('我卡了两天');
    expect(stripScaffold('【开场钩子】\n我卡了两天。')).not.toContain('开场钩子');
  });

  it('去掉独占一行的时间戳', () => {
    expect(stripScaffold('0-4秒\n我卡了两天。')).toBe('我卡了两天。');
    expect(stripScaffold('00:00-00:04\n我卡了两天。')).toBe('我卡了两天。');
  });

  it('去掉行首的序号', () => {
    expect(stripScaffold('1. 我卡了两天。')).toBe('我卡了两天。');
    expect(stripScaffold('一、我卡了两天。')).toBe('我卡了两天。');
  });

  it('去掉括号里的时间提示，但保留口语里的括号内容', () => {
    expect(stripScaffold('（0:00-0:03）我卡了两天。')).toBe('我卡了两天。');
    expect(stripScaffold('我卡了两天（真的）。')).toBe('我卡了两天（真的）。');
  });

  it('正常稿子一个字都不动', () => {
    const t = '我卡在一个开源项目的第三步，整整两天。装环境、配依赖、改路径。';
    expect(stripScaffold(t)).toBe(t);
  });

  it('不吃掉句子里的方括号内容以外的东西', () => {
    expect(stripScaffold('我做了个U盘，插上就能跑。')).toBe('我做了个U盘，插上就能跑。');
  });

  it('多余空行折成一个换行', () => {
    expect(stripScaffold('第一句。\n\n\n第二句。')).toBe('第一句。\n第二句。');
  });
});

describe('导入时的核对要按去掉标记后的正文来', () => {
  it('带时间标记的稿子, 切分结果不含标记也算忠实', async () => {
    const { checkImportFidelity } = await import('@/lib/llm/prompts/script-import');
    const { ACT_KEYS } = await import('@/lib/script/six-act');
    const raw = '【0-4秒】我卡了两天。\n【4-10秒】后来做了个U盘。';
    const acts = ACT_KEYS.map((act, i) => ({
      act, title: 't',
      narration: i === 0 ? '我卡了两天。' : i === 1 ? '后来做了个U盘。' : '',
    }));
    expect(checkImportFidelity(stripScaffold(raw), acts).faithful).toBe(true);
  });
});
