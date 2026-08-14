import { describe, expect, it } from 'vitest';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import type { PersonaProfileData } from '@/lib/persona/profile';

function makeProfile(overrides: Partial<PersonaProfileData> = {}): PersonaProfileData {
  return {
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
    painPoints: [],
    offerings: [],
    productLogic: '',
    marketInsight: null,
    systemSummary: '',
    ...overrides,
  };
}

describe('buildPersonaSection', () => {
  it('null → 空串', () => {
    expect(buildPersonaSection(null)).toBe('');
  });

  it('全字段齐全 → 包含全部结构化字段', () => {
    const out = buildPersonaSection(makeProfile());
    expect(out).toContain('25-35 岁互联网从业者');
    expect(out).toContain('想转行做 AI 的人');
    expect(out).toContain('工具评测');
    expect(out).toContain('拆解 AI 工具实际效果');
    expect(out).toContain('只讲能落地的方法');
    expect(out).toContain('不做标题党');
  });

  it('多条 pillars → 逐条 name：description 列出', () => {
    const out = buildPersonaSection(
      makeProfile({
        pillars: [
          { name: '工具评测', description: '拆解 AI 工具实际效果' },
          { name: '行业观察', description: '' },
        ],
      }),
    );
    expect(out).toContain('工具评测');
    expect(out).toContain('行业观察');
  });

  it('targetFans 为空串 → 该行省略', () => {
    const out = buildPersonaSection(makeProfile({ targetFans: '' }));
    expect(out).not.toContain('想转行做 AI 的人');
  });

  it('angle 为空串 → 该行省略', () => {
    const out = buildPersonaSection(makeProfile({ angle: '' }));
    expect(out).not.toContain('只讲能落地的方法');
  });

  it('avoid 为空串 → 该行省略', () => {
    const out = buildPersonaSection(makeProfile({ avoid: '' }));
    expect(out).not.toContain('不做标题党');
  });

  it('pillars 为空数组 → 内容支柱段落省略', () => {
    const out = buildPersonaSection(makeProfile({ pillars: [] }));
    expect(out).not.toContain('内容支柱');
  });

  it('所有字段皆空 (含空 pillars) → 空串', () => {
    const out = buildPersonaSection(makeProfile({
      audience: '',
      targetFans: '',
      pillars: [],
      angle: '',
      avoid: '',
    }));
    expect(out).toBe('');
  });

  it('audience 只有空白 → 该行省略', () => {
    const out = buildPersonaSection(makeProfile({ audience: '   ' }));
    expect(out).not.toContain('目标受众');
  });
});
