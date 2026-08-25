import { describe, expect, it } from 'vitest';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { buildStyleSection, buildChapterNavSection, actAtMs } from '@/lib/video-production/style-guard';

const PALETTE = ['#F5F2EA', '#1A1A1A', '#2563EB'];

describe('buildStyleSection (Director 用)', () => {
  it('不给风格时返回空串 —— 老模板 prompt 字符级不变', () => {
    expect(buildStyleSection(null)).toBe('');
    expect(buildStyleSection({ visualTone: 'dark', shotPaceSec: null })).toBe('');
  });

  it('亮底基调要求调色板以浅色为底、深色为字', () => {
    const s = buildStyleSection({ visualTone: 'light', shotPaceSec: null });
    expect(s).toMatch(/浅色|米白|亮底/);
    expect(s).toMatch(/深色/);
  });

  it('切镜节奏写进提示, 并明确覆盖既有的 40 秒上限', () => {
    const s = buildStyleSection({ visualTone: 'dark', shotPaceSec: 4 });
    expect(s).toContain('4');
    expect(s).toMatch(/40|上限|更短/);
  });

  it('两项可同时生效', () => {
    const s = buildStyleSection({ visualTone: 'light', shotPaceSec: 3 });
    expect(s).toMatch(/浅色|米白|亮底/);
    expect(s).toContain('3');
  });
});

describe('buildChapterNavSection (Builder 用)', () => {
  const acts = [
    { act: 'hook', title: '开场钩子' },
    { act: 'concept_a', title: '概念一' },
    { act: 'punchline', title: '金句收尾' },
  ];

  it('关闭时返回空串', () => {
    expect(buildChapterNavSection(false, acts, 'hook')).toBe('');
  });

  it('没有幕信息时返回空串, 不画半截导航', () => {
    expect(buildChapterNavSection(true, [], 'hook')).toBe('');
  });

  it('开启时列出全部章节标题', () => {
    const s = buildChapterNavSection(true, acts, 'concept_a');
    expect(s).toContain('开场钩子');
    expect(s).toContain('概念一');
    expect(s).toContain('金句收尾');
  });

  it('标出当前章节, 让 Builder 知道该高亮哪个', () => {
    const s = buildChapterNavSection(true, acts, 'concept_a');
    expect(s).toMatch(/当前.*概念一|概念一.*当前/s);
  });

  it('要求导航常驻整个镜头, 不许中途消失', () => {
    expect(buildChapterNavSection(true, acts, 'hook')).toMatch(/常驻|始终|全程/);
  });
});

describe('DIRECTOR 接风格段', () => {
  it('不传时与原来一致(零迁移)', () => {
    expect(DIRECTOR.buildSystemPrompt('', '')).toBe(DIRECTOR.buildSystemPrompt());
  });

  it('风格段出现在 prompt 里, 且输出契约仍在末位', () => {
    const p = DIRECTOR.buildSystemPrompt('', buildStyleSection({ visualTone: 'light', shotPaceSec: 4 }));
    expect(p).toMatch(/浅色|米白|亮底/);
    expect(p.indexOf('只输出 JSON')).toBeGreaterThan(p.indexOf('浅色'));
  });
});

describe('BUILDER 接章节导航段', () => {
  it('不传时与原来一致(零迁移)', () => {
    expect(BUILDER.buildSystemPrompt(PALETTE, 'card', '', '')).toBe(BUILDER.buildSystemPrompt(PALETTE, 'card'));
  });

  it('导航段出现在 prompt 里, 且输出契约仍在末位', () => {
    const nav = buildChapterNavSection(true, [{ act: 'hook', title: '开场钩子' }], 'hook');
    const p = BUILDER.buildSystemPrompt(PALETTE, 'card', '', nav);
    expect(p).toContain('开场钩子');
    expect(p.indexOf('只输出这一个 HTML')).toBeGreaterThan(p.indexOf('开场钩子'));
  });
});

describe('actAtMs 镜头→幕映射', () => {
  const acts = [
    { act: 'hook', targetSec: 10 },
    { act: 'concept_a', targetSec: 20 },
    { act: 'punchline', targetSec: 5 },
  ];

  it('落在第一幕', () => {
    expect(actAtMs(acts, 0)).toBe('hook');
    expect(actAtMs(acts, 9999)).toBe('hook');
  });

  it('边界毫秒归入下一幕(与 SRT 时间轴同源)', () => {
    expect(actAtMs(acts, 10000)).toBe('concept_a');
  });

  it('落在中间幕', () => {
    expect(actAtMs(acts, 25000)).toBe('concept_a');
  });

  it('落在最后一幕', () => {
    expect(actAtMs(acts, 32000)).toBe('punchline');
  });

  it('超出总时长归入最后一幕(分镜 endMs 取整可能略微越界)', () => {
    expect(actAtMs(acts, 999999)).toBe('punchline');
  });

  it('没有幕信息时返回 null', () => {
    expect(actAtMs([], 100)).toBeNull();
  });
});
