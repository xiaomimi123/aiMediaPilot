import { describe, expect, it } from 'vitest';
import { IMAGE_PLAN, ImagePlanSchema } from '@/lib/llm/prompts/image-plan';

// ---------------------------------------------------------------------------
// ImagePlanSchema — 边界
// ---------------------------------------------------------------------------

function makeValidPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    style: 'minimalist flat illustration, warm pastel palette, soft shadow',
    images: [
      { idx: 0, prompt: 'a'.repeat(20) },
      { idx: 1, prompt: 'b'.repeat(20) },
    ],
    ...overrides,
  };
}

describe('ImagePlanSchema — style 边界', () => {
  it('9 字 → 拒绝 (min 10)', () => {
    expect(() => ImagePlanSchema.parse(makeValidPlan({ style: 'a'.repeat(9) }))).toThrow();
  });

  it('10 字 → 通过 (min 10)', () => {
    expect(() => ImagePlanSchema.parse(makeValidPlan({ style: 'a'.repeat(10) }))).not.toThrow();
  });

  it('300 字 → 通过 (max 300)', () => {
    expect(() => ImagePlanSchema.parse(makeValidPlan({ style: 'a'.repeat(300) }))).not.toThrow();
  });

  it('301 字 → 拒绝 (max 300)', () => {
    expect(() => ImagePlanSchema.parse(makeValidPlan({ style: 'a'.repeat(301) }))).toThrow();
  });
});

describe('ImagePlanSchema — images 数组边界', () => {
  it('空数组 → 拒绝 (min 1)', () => {
    expect(() => ImagePlanSchema.parse(makeValidPlan({ images: [] }))).toThrow();
  });

  it('10 张 → 通过 (max 10)', () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ idx: i, prompt: 'x'.repeat(20) }));
    expect(() => ImagePlanSchema.parse(makeValidPlan({ images }))).not.toThrow();
  });

  it('11 张 → 拒绝 (max 10)', () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ idx: i % 10, prompt: 'x'.repeat(20) }));
    expect(() => ImagePlanSchema.parse(makeValidPlan({ images }))).toThrow();
  });
});

describe('ImagePlanSchema — images[].idx 边界', () => {
  it('idx=0 → 通过 (封面)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 0, prompt: 'x'.repeat(20) }] })),
    ).not.toThrow();
  });

  it('idx=9 → 通过 (max 9)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 9, prompt: 'x'.repeat(20) }] })),
    ).not.toThrow();
  });

  it('idx=-1 → 拒绝 (min 0)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: -1, prompt: 'x'.repeat(20) }] })),
    ).toThrow();
  });

  it('idx=10 → 拒绝 (max 9)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 10, prompt: 'x'.repeat(20) }] })),
    ).toThrow();
  });

  it('idx 非整数 → 拒绝', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 1.5, prompt: 'x'.repeat(20) }] })),
    ).toThrow();
  });
});

describe('ImagePlanSchema — images[].prompt 边界', () => {
  it('19 字 → 拒绝 (min 20)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 0, prompt: 'x'.repeat(19) }] })),
    ).toThrow();
  });

  it('20 字 → 通过 (min 20)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 0, prompt: 'x'.repeat(20) }] })),
    ).not.toThrow();
  });

  it('800 字 → 通过 (max 800)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 0, prompt: 'x'.repeat(800) }] })),
    ).not.toThrow();
  });

  it('801 字 → 拒绝 (max 800)', () => {
    expect(() =>
      ImagePlanSchema.parse(makeValidPlan({ images: [{ idx: 0, prompt: 'x'.repeat(801) }] })),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// IMAGE_PLAN.buildSystemPrompt
// ---------------------------------------------------------------------------

describe('IMAGE_PLAN.buildSystemPrompt', () => {
  it('含「海报大字」要求', () => {
    expect(IMAGE_PLAN.buildSystemPrompt('ai-knowledge')).toContain('海报大字');
  });

  it('含「准确清晰」要求', () => {
    expect(IMAGE_PLAN.buildSystemPrompt('ai-knowledge')).toContain('准确清晰');
  });

  it('提及 style (统一视觉风格)', () => {
    const p = IMAGE_PLAN.buildSystemPrompt('ai-knowledge');
    expect(p).toContain('style');
    expect(p).toMatch(/统一.*风格|风格.*统一/);
  });

  it('idx=0 对应封面, idx 1..N 对应 shotIdeas', () => {
    const p = IMAGE_PLAN.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/idx=0/);
    expect(p).toContain('封面');
    expect(p).toContain('shotIdeas');
  });

  it('要求竖版 3:4 构图', () => {
    const p = IMAGE_PLAN.buildSystemPrompt('ai-knowledge');
    expect(p).toContain('3:4');
  });

  it('包含 niche persona', () => {
    expect(IMAGE_PLAN.buildSystemPrompt('ai-knowledge')).toMatch(/AI 知识/);
  });

  it('要求 images 数组长度严格等于 1+shotIdeas 条数', () => {
    const p = IMAGE_PLAN.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/1.*封面.*shotIdeas|严格等于/);
  });
});

// ---------------------------------------------------------------------------
// IMAGE_PLAN.buildUserMessage
// ---------------------------------------------------------------------------

describe('IMAGE_PLAN.buildUserMessage', () => {
  const input = {
    coverText: '3 个技巧',
    intro: '你是不是也经常写完稿子还要来回改？今天分享几个小技巧。',
    body: '第一步, 先明确你的目标受众是谁。',
    shotIdeas: [
      { idx: 1, description: '封面大字截图' },
      { idx: 2, description: 'ChatGPT 输入框特写' },
    ],
  };

  it('包含 coverText / intro / body', () => {
    const parts = IMAGE_PLAN.buildUserMessage(input);
    const text = (parts[0] as any).text;
    expect(text).toContain(input.coverText);
    expect(text).toContain(input.intro);
    expect(text).toContain(input.body);
  });

  it('包含每条 shotIdea 的 idx 与 description', () => {
    const parts = IMAGE_PLAN.buildUserMessage(input);
    const text = (parts[0] as any).text;
    expect(text).toContain('封面大字截图');
    expect(text).toContain('ChatGPT 输入框特写');
    expect(text).toMatch(/idx=1/);
    expect(text).toMatch(/idx=2/);
  });

  it('提示 images 数组长度 = 1+shotIdeas 条数 (本例 = 3)', () => {
    const parts = IMAGE_PLAN.buildUserMessage(input);
    const text = (parts[0] as any).text;
    expect(text).toContain('= 3');
  });
});
