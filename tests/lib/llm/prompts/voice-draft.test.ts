import { describe, expect, it } from 'vitest';
import { VOICE_DRAFT, VoiceDraftResponseSchema } from '@/lib/llm/prompts/voice-draft';

const BASE = {
  origin: 'a'.repeat(30),
  identity: '一个普通人',
  notIdentity: '不是技术极客也不是程序员',
  stances: [{ claim: 'x', reason: 'y' }],
  energy: '自信',
  experienceCandidates: [],
};

describe('VoiceDraftResponseSchema', () => {
  it('基础形状通过', () => {
    expect(VoiceDraftResponseSchema.safeParse(BASE).success).toBe(true);
  });

  it('origin 宽进严出: 超 500 字被截断到 500 而非报错', () => {
    const parsed = VoiceDraftResponseSchema.parse({ ...BASE, origin: 'a'.repeat(900) });
    expect(parsed.origin).toHaveLength(500);
  });

  it('origin 短于 20 拒 / 超过 1200 拒(宽收也有上限)', () => {
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, origin: 'a'.repeat(19) }).success).toBe(false);
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, origin: 'a'.repeat(1201) }).success).toBe(false);
  });

  it('stance reason 宽进严出截到 100', () => {
    const parsed = VoiceDraftResponseSchema.parse({
      ...BASE,
      stances: [{ claim: 'x', reason: 'r'.repeat(280) }],
    });
    expect(parsed.stances[0].reason).toHaveLength(100);
  });

  it('主键性字段严格拒绝: identity 201 / notIdentity 201 / claim 51', () => {
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, identity: 'a'.repeat(201) }).success).toBe(false);
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, notIdentity: 'a'.repeat(201) }).success).toBe(false);
    expect(
      VoiceDraftResponseSchema.safeParse({ ...BASE, stances: [{ claim: 'a'.repeat(51), reason: 'y' }] }).success,
    ).toBe(false);
  });

  it('stances 至少 1 条、至多 5 条', () => {
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, stances: [] }).success).toBe(false);
    const six = Array.from({ length: 6 }, () => ({ claim: 'x', reason: 'y' }));
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, stances: six }).success).toBe(false);
  });

  it('experienceCandidates 至多 5 条, 每条 10-500 字', () => {
    expect(
      VoiceDraftResponseSchema.safeParse({ ...BASE, experienceCandidates: ['太短'] }).success,
    ).toBe(false);
    const five = Array.from({ length: 5 }, () => 'a'.repeat(20));
    expect(VoiceDraftResponseSchema.safeParse({ ...BASE, experienceCandidates: five }).success).toBe(true);
    expect(
      VoiceDraftResponseSchema.safeParse({ ...BASE, experienceCandidates: [...five, 'a'.repeat(20)] }).success,
    ).toBe(false);
  });
});

describe('VOICE_DRAFT.buildSystemPrompt', () => {
  const sys = VOICE_DRAFT.buildSystemPrompt('ai-knowledge');

  it('identity 要求给了品类标签的反例→正例对照', () => {
    expect(sys).toContain('坏例');
    expect(sys).toContain('好例');
    expect(sys).toContain('AI 知识博主'); // 反例本身
  });

  it('notIdentity 明确禁止美化成优点(护栏不可拆)', () => {
    expect(sys).toContain('不许美化成优点');
    expect(sys).toContain('护栏');
  });

  it('stances 要求可能得罪人, 拒绝无立场表述', () => {
    expect(sys).toContain('得罪');
    expect(sys).toContain('理性看待 AI'); // 无立场反例
  });

  it('经历候选禁止编造与润色', () => {
    expect(sys).toContain('不要编造');
    expect(sys).toContain('不要润色');
  });

  it('不含任何语言风格字段要求(语言层归风格档案)', () => {
    // 只看本 prompt 自己的任务描述部分 —— getExpertPersona 前缀是共享的垂类爆款规律,
    // 里面出现"句式"等词与人物志的字段职责无关, 不该被这条断言误伤。
    const taskBody = sys.slice(sys.indexOf('任务:'));
    expect(taskBody).not.toContain('口头禅');
    expect(taskBody).not.toContain('语言风格');
    expect(taskBody).toContain('归风格档案'); // 反向确认: 明确声明了语言层不归自己管
  });
});

describe('VOICE_DRAFT energy 约束 (T6 真实 E2E 驱动的修复)', () => {
  const sys = VOICE_DRAFT.buildSystemPrompt('ai-knowledge');

  it('明确 energy 只能从用户原话提取, 不许发明', () => {
    expect(sys).toContain('不许发明');
  });

  it('明确区分「观众的感受」与「他的表达风格」, 防止反推出相反特质', () => {
    expect(sys).toContain('观众的');
    expect(sys).toContain('不要反推成');
  });

  it('明确 energy 不得与 notIdentity 冲突', () => {
    expect(sys).toContain('不得与 notIdentity 冲突');
  });
});
