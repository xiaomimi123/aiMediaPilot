import { describe, expect, it } from 'vitest';
import { renderCoverHtml, type CoverCopy } from '@/lib/sources/cover';

const base: CoverCopy = {
  coverText: ['一条命令', '本地跑大模型'],
  kicker: '开源快讯',
  sub: 'Ollama 一行命令在本地跑开源大模型。',
  pick: 'plain',
  points: [],
  command: '',
};

describe('renderCoverHtml', () => {
  it('产出 1080×1440 页面, 大字/仓库名/署名都在', () => {
    const html = renderCoverHtml(base, { repo: 'ollama/ollama', starCount: 102000 });
    expect(html).toContain('width:1080px');
    expect(html).toContain('height:1440px');
    expect(html).toContain('一条命令');
    expect(html).toContain('ollama/ollama');
    expect(html).toContain('102,000 ★');
    expect(html).not.toContain('<script');
  });

  it('points 变体出黑描边卖点卡', () => {
    const html = renderCoverHtml({ ...base, pick: 'points', points: ['无需模拟器', '全程本地'] }, { repo: 'x/y', starCount: null });
    expect(html).toContain('box-shadow:8px 8px 0');
    expect(html).toContain('无需模拟器');
  });

  it('command 变体出终端命令块', () => {
    const html = renderCoverHtml({ ...base, pick: 'command', command: 'npm i -g x' }, { repo: 'x/y', starCount: null });
    expect(html).toContain('npm i -g x');
    expect(html).toContain('$');
  });

  it('HTML 特殊字符转义', () => {
    const html = renderCoverHtml({ ...base, coverText: ['<b>粗体</b>'], sub: 'a"&b' }, { repo: 'x/y', starCount: null });
    expect(html).not.toContain('<b>粗体</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('pick=plain 时底部为空', () => {
    const html = renderCoverHtml(base, { repo: 'x/y', starCount: null });
    expect(html).not.toContain('class="points"');
    expect(html).not.toContain('class="cmd"');
  });
});
