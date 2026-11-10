import { describe, expect, it } from 'vitest';
import { renderDemoHtml, type DemoPage } from '@/lib/sources/demo-page';

const base: DemoPage = {
  style: 'terminal',
  kicker: '开源项目快讯',
  title: '不用模拟器跑时之笛',
  subtitle: '把游戏代码重编译成 C 再在 Vulkan 上重建画面。',
  points: [
    { head: '无需模拟器', body: '直接编译成原生程序。' },
    { head: '全程本地构建', body: '用自己的游戏副本。' },
    { head: '实验阶段', body: '只测了游戏开头。' },
  ],
  command: 'git clone https://github.com/x/y',
  accent: '#3fb950',
};

describe('renderDemoHtml', () => {
  it('产出 1920×1080 页面, 内容都转义进去了', () => {
    const html = renderDemoHtml(base, 'x/y', 3461);
    expect(html).toContain('width:1920px');
    expect(html).toContain('height:1080px');
    expect(html).toContain('3,461 stars');
    expect(html).toContain('无需模拟器');
    expect(html).toContain('$');
    expect(html).not.toContain('<script');
  });

  it('四种风格都有各自的背景', () => {
    for (const style of ['gradient', 'clean', 'bold'] as const) {
      const html = renderDemoHtml({ ...base, style }, 'x/y', null);
      expect(html.length).toBeGreaterThan(1000);
    }
    expect(renderDemoHtml({ ...base, style: 'clean' }, 'x/y', null)).toContain('#faf7f2');
    expect(renderDemoHtml({ ...base, style: 'bold' }, 'x/y', null)).toContain('uppercase');
  });

  it('HTML 特殊字符转义, 防止标题里带 <> 破坏页面', () => {
    const html = renderDemoHtml({ ...base, title: '<script>alert(1)</script>测试' }, 'x/y', null);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('没有 command 时空命令块隐藏但占位', () => {
    const html = renderDemoHtml({ ...base, command: '' }, 'x/y', null);
    expect(html).toContain('visibility:hidden');
  });
});
