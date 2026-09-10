import { describe, expect, it } from 'vitest';
import { contentPlanGenerateSchema } from '@/lib/content-plan/model';

const PILLARS = ['AI 工具实操', '效率方法论'];

function makeDay(overrides: Partial<Record<string, unknown>> = {}, dayIndex = 1) {
  return {
    dayIndex,
    pillarName: PILLARS[0],
    topic: '用 AI 三分钟写完周报',
    angle: '从"不会写"切入,展示提示词模板',
    hookDirection: '先抛结果反差,再倒叙讲怎么做到的',
    ...overrides,
  };
}

function makeDays(count: number) {
  return Array.from({ length: count }, (_, i) => makeDay({}, i + 1));
}

describe('contentPlanGenerateSchema', () => {
  it('30 条合法数据 → 通过', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const result = schema.safeParse({ days: makeDays(30) });
    expect(result.success).toBe(true);
  });

  it('29 条 → 拒绝(不接受部分成功)', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const result = schema.safeParse({ days: makeDays(29) });
    expect(result.success).toBe(false);
  });

  it('31 条 → 拒绝', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const result = schema.safeParse({ days: makeDays(31) });
    expect(result.success).toBe(false);
  });

  it('pillarName 不在快照支柱名内 → 拒绝', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const days = makeDays(30);
    days[0] = makeDay({ pillarName: '编出来的支柱' }, 1);
    const result = schema.safeParse({ days });
    expect(result.success).toBe(false);
  });

  it('pillarName 为空串(未挂支柱) → 通过', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const days = makeDays(30);
    days[0] = makeDay({ pillarName: '' }, 1);
    const result = schema.safeParse({ days });
    expect(result.success).toBe(true);
  });

  it('day item 含 schema 外多余键 → 拒绝(.strict())', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const days = makeDays(30);
    days[0] = { ...makeDay({}, 1), extra: '不该有这个字段' } as ReturnType<typeof makeDay>;
    const result = schema.safeParse({ days });
    expect(result.success).toBe(false);
  });

  it('响应体含 schema 外多余键 → 拒绝(.strict())', () => {
    const schema = contentPlanGenerateSchema(PILLARS);
    const result = schema.safeParse({ days: makeDays(30), extra: 'x' });
    expect(result.success).toBe(false);
  });
});
