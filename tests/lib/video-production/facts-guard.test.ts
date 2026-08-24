import { describe, expect, it } from 'vitest';
import { buildFactsSection } from '@/lib/video-production/facts-guard';
import type { ScriptAct } from '@/lib/script/six-act';

function act(overrides: Partial<ScriptAct>): ScriptAct {
  return {
    act: 'hook',
    title: '标题',
    narration: '台词',
    visual: '画面',
    note: '备注',
    targetSec: 10,
    beats: [{ keyword: 'k1' }, { keyword: 'k2' }, { keyword: 'k3' }],
    facts: [],
    ...overrides,
  } as ScriptAct;
}

describe('buildFactsSection', () => {
  it('没有六幕稿(空数组)时返回空串 —— 老任务行为不变', () => {
    expect(buildFactsSection([])).toBe('');
  });

  it('高把握事实进清单, 带取值与来源', () => {
    const s = buildFactsSection([
      act({
        facts: [
          { claim: 'DeepSeek 融资额', value: '74 亿美元', source: 'WSJ 报道', confidence: 'high' },
        ],
      }),
    ]);
    expect(s).toContain('74 亿美元');
    expect(s).toContain('WSJ 报道');
    expect(s).toContain('DeepSeek 融资额');
  });

  it('中低把握事实不进清单 —— 它们正是不许被画成数字的那批', () => {
    // 夹具用不会与 prompt 正文举例撞字的独特串: 正文里拿"好几倍"当反面例子, 直接用它
    // 会让断言误判成"低把握事实泄漏进了清单"。
    const s = buildFactsSection([
      act({
        facts: [
          { claim: 'ZZZ 价格', value: '低把握取值 QQQ', source: '推测', confidence: 'low' },
          { claim: 'YYY 原因', value: '中把握取值 WWW', source: '推测', confidence: 'medium' },
        ],
      }),
    ]);
    expect(s).not.toContain('QQQ');
    expect(s).not.toContain('WWW');
    expect(s).not.toContain('ZZZ');
    expect(s).not.toContain('YYY');
  });

  it('有六幕稿但一条高把握事实都没有时, 仍然输出画面纪律(此时最需要)', () => {
    const s = buildFactsSection([act({ facts: [] })]);
    expect(s).not.toBe('');
    expect(s).toContain('画面事实纪律');
  });

  it('画面纪律必须点名禁止清单外的数字/图表/对比', () => {
    const s = buildFactsSection([act({ facts: [] })]);
    expect(s).toMatch(/数字/);
    expect(s).toMatch(/图表|对比/);
  });

  it('画面纪律必须禁止把模糊表述具体化成数字', () => {
    expect(buildFactsSection([act({ facts: [] })])).toMatch(/模糊/);
  });

  it('画面纪律必须禁止混口径对比(不同货币/单位)', () => {
    const s = buildFactsSection([act({ facts: [] })]);
    expect(s).toMatch(/货币|口径|单位/);
  });

  it('跨幕的事实全部汇总进同一份清单', () => {
    const s = buildFactsSection([
      act({ act: 'hook', facts: [{ claim: 'A', value: 'a 值', source: 'a 源', confidence: 'high' }] }),
      act({ act: 'trivia', facts: [{ claim: 'B', value: 'b 值', source: 'b 源', confidence: 'high' }] }),
    ]);
    expect(s).toContain('a 值');
    expect(s).toContain('b 值');
  });
});
