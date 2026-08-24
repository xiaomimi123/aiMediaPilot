import { describe, expect, it } from 'vitest';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';

const PALETTE = ['#111111', '#222222', '#333333'];
const SECTION = '\n\n可以坐实的事实清单(测试用): 只有 A 允许上画面';

describe('DIRECTOR 事实护栏注入', () => {
  it('不传 factsSection 时与传空串字符级一致(零迁移)', () => {
    expect(DIRECTOR.buildSystemPrompt('')).toBe(DIRECTOR.buildSystemPrompt());
  });

  it('传了 factsSection 时内容出现在 prompt 里', () => {
    expect(DIRECTOR.buildSystemPrompt(SECTION)).toContain('只有 A 允许上画面');
  });

  it('注入后既有的分镜规则仍在', () => {
    const p = DIRECTOR.buildSystemPrompt(SECTION);
    expect(p).toContain('整数毫秒');
    expect(p).toContain('palette');
  });

  it('输出格式契约必须仍在 prompt 末尾, 不被事实护栏挤走', () => {
    // 真实出片踩过: 护栏加在最末尾会把"只输出 JSON"从末位挤走, 模型跟随度下降。
    const p = DIRECTOR.buildSystemPrompt(SECTION);
    expect(p.indexOf('只输出 JSON')).toBeGreaterThan(p.indexOf('只有 A 允许上画面'));
  });
});

describe('BUILDER 事实护栏注入', () => {
  it('不传 factsSection 时与传空串字符级一致(零迁移)', () => {
    expect(BUILDER.buildSystemPrompt(PALETTE, 'card', '')).toBe(BUILDER.buildSystemPrompt(PALETTE, 'card'));
    expect(BUILDER.buildSystemPrompt(PALETTE, 'illustration', '')).toBe(
      BUILDER.buildSystemPrompt(PALETTE, 'illustration'),
    );
  });

  it('省略 visualStyle 与 factsSection 时与只传调色板一致(零迁移)', () => {
    expect(BUILDER.buildSystemPrompt(PALETTE)).toBe(BUILDER.buildSystemPrompt(PALETTE, 'card'));
  });

  it('传了 factsSection 时内容出现在 prompt 里', () => {
    expect(BUILDER.buildSystemPrompt(PALETTE, 'card', SECTION)).toContain('只有 A 允许上画面');
  });

  it('注入后既有的技术契约仍在(渲染工具依赖它截帧)', () => {
    const p = BUILDER.buildSystemPrompt(PALETTE, 'card', SECTION);
    expect(p).toContain('1920x1080');
    expect(p).toContain('window.__timelines');
    expect(p).toContain(PALETTE.join(', '));
  });

  it('输出格式契约必须仍在 prompt 末尾, 不被事实护栏挤走', () => {
    // 真实出片踩过: 护栏加在最末尾时, Builder 有一镜漏写 window.__timelines["shot"] = tl,
    // 整条任务在渲染阶段崩掉。技术契约必须保持末位。
    const p = BUILDER.buildSystemPrompt(PALETTE, 'card', SECTION);
    expect(p.indexOf('只输出这一个 HTML')).toBeGreaterThan(p.indexOf('只有 A 允许上画面'));
    expect(p.trimEnd().endsWith('</html> 结束。')).toBe(true);
  });

  it('插画风格与事实护栏可以同时生效', () => {
    const p = BUILDER.buildSystemPrompt(PALETTE, 'illustration', SECTION);
    expect(p).toContain('插画风格');
    expect(p).toContain('只有 A 允许上画面');
  });
});
