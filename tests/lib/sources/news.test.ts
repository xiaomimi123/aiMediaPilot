import { describe, expect, it } from 'vitest';
import { newsMessage, stripMarkdown, NEWS_TARGET_SEC } from '@/lib/sources/news';
import type { StructuredLLM } from '@/lib/script/write';
import { writeNewsScript } from '@/lib/sources/news';

describe('stripMarkdown', () => {
  it('去掉代码块、图片、链接标记、标题井号, 保留正文', () => {
    const md = [
      '# My Project',
      '',
      'A [fast](https://x.com) tool for **everyone**.',
      '',
      '```bash',
      'npm install x',
      '```',
      '',
      '![logo](https://x.com/logo.png)',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    const out = stripMarkdown(md);
    expect(out).toContain('My Project');
    expect(out).toContain('A fast tool for everyone.');
    expect(out).not.toContain('npm install');
    expect(out).not.toContain('logo.png');
    expect(out).not.toContain('|');
    expect(out).not.toContain('](http');
  });
});

describe('newsMessage', () => {
  it('带仓库信息、README、30 秒目标与 6 段节拍', () => {
    const m = newsMessage({ repo: 'user/repo', starCount: 12345, readme: '一个工具' });
    expect(m).toContain('user/repo（GitHub 12,345 stars）');
    expect(m).toContain('【README 摘录】\n一个工具');
    expect(m).toContain('30 秒');
    expect(m).toContain('钩子');
  });
  it('star 为空时不显示 stars', () => {
    const m = newsMessage({ repo: 'r', starCount: null, readme: 'x' });
    expect(m).not.toContain('stars');
  });
});

describe('writeNewsScript', () => {
  const llm = (segments: string[], title = '标题') =>
    ({
      callStructured: async () => ({
        result: { title, segments: segments.map((text) => ({ text })) },
        usage: {},
      }),
    }) as unknown as StructuredLLM;

  it('按位置对齐 6 段角色', async () => {
    const r = await writeNewsScript({ llm: llm(['钩子词。', '这是个工具。', '它火了。', 'npm 装。', '有坑。', '下期见。']), repo: 'r', starCount: 1, readme: 'x' });
    expect(r.script.segments.map((s) => s.role)).toEqual(['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close']);
    expect(r.script.segments.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });

  it('空段报错', async () => {
    await expect(
      writeNewsScript({ llm: llm(['钩子。', '', 'b', 'c', 'd', 'e']), repo: 'r', starCount: null, readme: 'x' }),
    ).rejects.toThrow('空段');
  });
});
