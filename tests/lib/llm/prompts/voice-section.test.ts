import { describe, expect, it } from 'vitest';
import { buildVoiceSection } from '@/lib/llm/prompts/voice-section';
import type { CreatorVoiceData, ExperienceItem } from '@/lib/persona/voice';

const VOICE: CreatorVoiceData = {
  origin: '被裁之后开始用 AI 自救',
  identity: '一个靠 AI 提高认知的普通人',
  notIdentity: '不是技术极客, 也不是专业程序员',
  stances: [{ claim: '提示词工程是伪需求', reason: '模型在进步' }],
  energy: '自信、有感染力',
};

function exp(over: Partial<ExperienceItem> & { id: string }): ExperienceItem {
  return {
    content: '上周做封面翻车三次',
    topic: 'AI 配图',
    kind: 'failure',
    keywords: [],
    usedCount: 0,
    createdAt: '2026-08-16T00:00:00.000Z',
    ...over,
  };
}

describe('buildVoiceSection', () => {
  it('人物志与经历皆空 → 空串(零迁移: 写稿 prompt 保持字符级一致)', () => {
    expect(buildVoiceSection(null, [])).toBe('');
  });

  it('只有人物志(无经历)也注入 —— 两份档案互不依赖', () => {
    const got = buildVoiceSection(VOICE, []);
    expect(got).toContain('一个靠 AI 提高认知的普通人');
    expect(got).not.toContain('真实经历');
  });

  it('只有经历(无人物志)也注入', () => {
    const got = buildVoiceSection(null, [exp({ id: 'e1' })]);
    expect(got).toContain('上周做封面翻车三次');
    expect(got).not.toContain('身份:');
  });

  it('notIdentity 带「不要把他写成」护栏措辞', () => {
    const got = buildVoiceSection(VOICE, []);
    expect(got).toContain('不是技术极客');
    expect(got).toContain('不要把他写成');
  });

  it('经历段必须带「不相关就别用, 不要硬凑」护栏', () => {
    const got = buildVoiceSection(VOICE, [exp({ id: 'e1' })]);
    expect(got).toContain('不要硬凑');
    expect(got).toContain('优先用它们而不是外部案例');
  });

  it('经历带类型中文标签; kind 为空时不渲染方括号', () => {
    expect(buildVoiceSection(null, [exp({ id: 'e1', kind: 'failure' })])).toContain('[翻车]');
    expect(buildVoiceSection(null, [exp({ id: 'e2', kind: '' })])).not.toContain('[]');
  });

  it('立场逐条列出, reason 为空时只列 claim', () => {
    const got = buildVoiceSection(
      { ...VOICE, stances: [{ claim: '只有主张', reason: '' }] },
      [],
    );
    expect(got).toContain('只有主张');
    expect(got).not.toContain('—— \n');
  });

  it('空字段不产出空行(origin/energy 为空时省略)', () => {
    const got = buildVoiceSection({ ...VOICE, origin: '', energy: '', notIdentity: '' }, []);
    expect(got).not.toContain('来路:');
    expect(got).not.toContain('表达能量:');
    expect(got).not.toContain('你不是:');
    expect(got).toContain('身份:'); // identity 仍在
  });
});
