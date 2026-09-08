import { describe, it, expect } from 'vitest';
import { OVERLAY_PLAN } from '@/lib/llm/prompts/overlay-plan';
import { extractOverlayPlan } from '@/lib/video-production/overlay-extraction';

const segments = [
  { startMs: 0, endMs: 3000, text: '刷到过三天赚五千吗' },
  { startMs: 3000, endMs: 6000, text: '这背后其实是个真实的付费逻辑' },
];

const goodItem = { kind: 'keyword', text: '付费逻辑', slot: 'left-1', startMs: 0, endMs: 3000 };
// text 超过 14 字上限(schema 红线, 复用 archaeology 版同款超长测例风格)
const tooLongItem = {
  kind: 'keyword', text: '这句关键词写得实在太长超过十四个字了吧', slot: 'left-1', startMs: 0, endMs: 3000,
};

/** 按顺序吐出预设答案的假 LLM, 并记下每次收到的 user message(风格照 film-plan-builder.test.ts)。 */
const fakeLLM = (responses: unknown[]) => {
  const remaining = [...responses];
  const seen: string[] = [];
  return {
    seen,
    callStructured: async (opts: any) => {
      seen.push(opts.userMessage.map((p: any) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: {} };
    },
  };
};

describe('OVERLAY_PLAN prompt: 考古复活', () => {
  it('system prompt 含五条硬规则的关键句', () => {
    const text = OVERLAY_PLAN.buildSystemPrompt();
    expect(text).toContain('绝不把字幕原句抄成关键词');
    expect(text).toContain('一屏同时最多 3 个元素');
  });

  it('红线: 全文不出现 x/y/坐标字样', () => {
    const text = OVERLAY_PLAN.buildSystemPrompt();
    expect(text).not.toMatch(/\bx\b/);
    expect(text).not.toMatch(/\by\b/);
    expect(text).not.toContain('坐标');
  });
});

describe('extractOverlayPlan', () => {
  it('一次合法解析出 items', async () => {
    const llm = fakeLLM([{ items: [goodItem] }]);
    const { plan, notice } = await extractOverlayPlan({ llm: llm as any, segments, durationMs: 6000 });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].text).toBe('付费逻辑');
    expect(notice).toBeNull();
  });

  it('text 超长: 修复循环收到的 issue 里含该路径', async () => {
    const llm = fakeLLM([{ items: [tooLongItem] }, { items: [goodItem] }]);
    const { plan } = await extractOverlayPlan({ llm: llm as any, segments, durationMs: 6000 });
    expect(plan.items).toHaveLength(1);
    expect(llm.seen[1]).toContain('items.0.text');
  });

  it('两轮仍败: 返回空 items + notice 非空(提取失败不拦片)', async () => {
    const bad = { items: [tooLongItem] };
    const llm = fakeLLM([bad, bad, bad]);
    const { plan, notice } = await extractOverlayPlan({ llm: llm as any, segments, durationMs: 6000 });
    expect(plan.items).toEqual([]);
    expect(notice).toBeTruthy();
  });
});
