import { describe, expect, it } from 'vitest';
import {
  ACT_KEYS,
  SixActScriptSchema,
  allocateActSeconds,
  isSixActScript,
  type ActKey,
} from '@/lib/script/six-act';

/** 构造一个通过校验的最小合法幕, 供各测试按需覆盖字段。 */
function makeAct(act: ActKey, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    act,
    title: '标题',
    narration: '这是一段足够长的口播文案示例内容',
    visual: '画面提示',
    note: '备注说明',
    targetSec: 10,
    beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
    facts: [],
    ...overrides,
  };
}

function makeValidScript() {
  return {
    acts: ACT_KEYS.map((act) => makeAct(act)),
    four_dims: { gain: '收获', surprise: '意外', clarity: '清晰', appeal: '吸引' },
  };
}

describe('SixActScriptSchema 顺序校验', () => {
  it('乱序 6 项拒', () => {
    const script = makeValidScript();
    // 交换前两项顺序, 集合仍然完整但顺序错误
    [script.acts[0], script.acts[1]] = [script.acts[1], script.acts[0]];
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('缺 1 幕拒', () => {
    const script = makeValidScript();
    script.acts = script.acts.slice(0, 5);
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('多 1 幕拒', () => {
    const script = makeValidScript();
    (script.acts as unknown[]).push(makeAct('punchline'));
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('六幕按 ACT_KEYS 顺序合法 → 通过', () => {
    const script = makeValidScript();
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(true);
  });
});

describe('SixActScriptSchema 宽进严出截断', () => {
  it('narration 1200 字 → 截断 800', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { narration: 'a'.repeat(1200) });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acts[0].narration.length).toBe(800);
    }
  });

  it('visual 200 字 → 截断 80', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { visual: 'b'.repeat(200) });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acts[0].visual.length).toBe(80);
    }
  });

  it('note 300 字 → 截断 120', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { note: 'c'.repeat(300) });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acts[0].note.length).toBe(120);
    }
  });
});

describe('SixActScriptSchema 其它字段约束', () => {
  it('title 21 字拒', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { title: '标'.repeat(21) });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('beats 2 个拒', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { beats: [{ keyword: 'a' }, { keyword: 'b' }] });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('beats 6 个拒', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', {
      beats: Array.from({ length: 6 }, (_, i) => ({ keyword: `k${i}` })),
    });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });

  it('facts confidence 非枚举拒', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', {
      facts: [{ claim: 'c', value: 'v', source: 's', confidence: 'super-high' }],
    });
    const result = SixActScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
  });
});

describe('allocateActSeconds', () => {
  it.each([30, 45, 60, 90])('durationSec=%i: sum 等于入参且每幕 ≥1', (durationSec) => {
    const allocation = allocateActSeconds(durationSec);
    const sum = ACT_KEYS.reduce((acc, key) => acc + allocation[key], 0);
    expect(sum).toBe(durationSec);
    for (const key of ACT_KEYS) {
      expect(allocation[key]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('isSixActScript', () => {
  it('六幕对象 → true', () => {
    expect(isSixActScript(makeValidScript())).toBe(true);
  });

  it('旧 sections 对象 → false', () => {
    expect(isSixActScript({ sections: [{ text: 'x' }] })).toBe(false);
  });

  it('null → false', () => {
    expect(isSixActScript(null)).toBe(false);
  });

  it('缺 four_dims → false', () => {
    const script = makeValidScript() as { acts: unknown; four_dims?: unknown };
    delete script.four_dims;
    expect(isSixActScript(script)).toBe(false);
  });
});
