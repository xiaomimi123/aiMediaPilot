import { describe, expect, it } from 'vitest';
import { SCRIPT_WRITE_DOUYIN, buildTemplateSection } from '@/lib/llm/prompts/script-write-douyin';
import type { StyleContext } from '@/lib/llm/prompts/script-write-douyin';

// 与 script-quality.test.ts / voice-parity.test.ts 同一套真实 StyleContext 构造
// (StyleContext 定义见 script-write-douyin.ts: mode/description/samples)。
const STYLE: StyleContext = { mode: 'description', description: '口语化, 短句', samples: [] };

describe('buildTemplateSection', () => {
  it('无配置 → 空串(不传/传 null 都是)', () => {
    expect(buildTemplateSection(null)).toBe('');
    expect(buildTemplateSection({})).toBe('');
  });

  it('语气写进提示', () => {
    const s = buildTemplateSection({ tone: '轻松吐槽' });
    expect(s).toContain('轻松吐槽');
  });

  it('钩子套路写进提示', () => {
    const s = buildTemplateSection({ hookHint: '用反常识数字开场' });
    expect(s).toContain('用反常识数字开场');
  });

  it('额外要求写进提示', () => {
    const s = buildTemplateSection({ extraGuidance: '每幕结尾留一个悬念' });
    expect(s).toContain('每幕结尾留一个悬念');
  });

  it('多项配置同时出现', () => {
    const s = buildTemplateSection({ tone: 'A语气', hookHint: 'B钩子', extraGuidance: 'C要求' });
    expect(s).toContain('A语气');
    expect(s).toContain('B钩子');
    expect(s).toContain('C要求');
  });
});

describe('SCRIPT_WRITE_DOUYIN.buildSystemPrompt 模板注入', () => {
  it('不传 templateSection 时与传空串字符级一致(零迁移)', () => {
    const without = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE);
    const withEmpty = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', '');
    expect(withEmpty).toBe(without);
  });

  it('传了 templateSection 时内容出现在 prompt 里', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', buildTemplateSection({ tone: '冷幽默' }));
    expect(p).toContain('冷幽默');
  });

  it('模板提示不影响六幕结构等既有硬性要求仍在', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', buildTemplateSection({ tone: '冷幽默' }));
    expect(p).toContain('六幕结构与职责');
    expect(p).toContain('科普严谨性');
  });
});
