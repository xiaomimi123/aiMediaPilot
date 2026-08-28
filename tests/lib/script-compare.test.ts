import { describe, it, expect } from 'vitest';
import { ACT_KEYS } from '@/lib/script/six-act';
import {
  SCRIPT_COMPARE,
  isTooSmallToTeach,
  looksCopiedFromCompare,
  ScriptCompareResponseSchema,
  checkCompareFacts,
  overlapWithCompare,
} from '@/lib/llm/prompts/script-compare';

const MINE = '我以前觉得做内容就是要每天更新。后来连着更了两个月，最好的一条也就三千播放。';

describe('SCRIPT_COMPARE prompt', () => {
  it('把用户原文交给模型', () => {
    const msg = SCRIPT_COMPARE.buildUserMessage({ acts: [{ act: 'hook', narration: MINE }] });
    const text = msg.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('三千播放');
  });

  it('禁止编造用户没说过的事', () => {
    expect(SCRIPT_COMPARE.buildSystemPrompt()).toContain('没说过');
  });

  it('要求说明改了什么手法 —— 对照版本身不教人，说明才教人', () => {
    expect(SCRIPT_COMPARE.buildSystemPrompt()).toMatch(/为什么|手法|差在哪/);
  });
});

describe('ScriptCompareResponseSchema', () => {
  const one = {
    act: 'hook', rewritten: '连更两个月，最好一条三千播放。',
    whatChanged: '把结论提前', keep: false,
  };

  it('每一幕都要带「改了什么」', () => {
    expect(ScriptCompareResponseSchema.safeParse({ acts: [one], overallNote: '结论前置' }).success).toBe(true);
    expect(
      ScriptCompareResponseSchema.safeParse({
        acts: [{ act: 'hook', rewritten: '连更两个月。', keep: false }],
        overallNote: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('checkCompareFacts', () => {
  it('对照版只用原文里有的数字，算干净', () => {
    const r = checkCompareFacts(MINE, '连更两个月，最好一条三千播放。');
    expect(r.clean).toBe(true);
  });

  it('对照版冒出原文没有的数字，标出来', () => {
    const r = checkCompareFacts(MINE, '连更两个月，涨了 5000 个粉。');
    expect(r.clean).toBe(false);
    expect(r.inventedNumbers).toContain('5000');
  });
});

describe('overlapWithCompare', () => {
  it('照抄对照版会被算出高重合', () => {
    const c = '连更两个月，最好一条三千播放。';
    expect(overlapWithCompare(c, c)).toBeGreaterThan(0.95);
  });

  it('自己重写过的重合低', () => {
    expect(overlapWithCompare('我更了两个月，数据很难看。', '连更两个月，最好一条三千播放。')).toBeLessThan(0.75);
  });

  it('没有对照版时是 0', () => {
    expect(overlapWithCompare('随便写点什么', '')).toBe(0);
  });
});

describe('六幕齐全性', () => {
  it('act 只能是六幕之一', () => {
    const bad = ScriptCompareResponseSchema.safeParse({
      acts: [{ act: 'nope', rewritten: 'x', whatChanged: 'y', keep: false }],
      overallNote: 'z',
    });
    expect(bad.success).toBe(false);
    expect(ACT_KEYS.length).toBe(6);
  });
});

describe('对照要给得出真东西', () => {
  it('要求换一个写法选择, 不是改词', () => {
    const p = SCRIPT_COMPARE.buildSystemPrompt();
    expect(p).toMatch(/换.{0,6}词|改词|润色/);
  });

  it('禁止拿评价当手法说明', () => {
    expect(SCRIPT_COMPARE.buildSystemPrompt()).toContain('不能学');
  });

  it('这一幕不用改时也要说出为什么它成立', () => {
    const p = SCRIPT_COMPARE.buildSystemPrompt();
    expect(p).toContain('keep');
  });

  it('keep 是必填 —— 前端要据此换一种呈现', () => {
    const noKeep = ScriptCompareResponseSchema.safeParse({
      acts: [{ act: 'hook', rewritten: 'x', whatChanged: 'y' }],
      overallNote: 'z',
    });
    expect(noKeep.success).toBe(false);
  });
});

describe('isTooSmallToTeach', () => {
  it('只改一两个字的, 拦掉 —— 教的是「进步 = 抠字眼」', () => {
    expect(isTooSmallToTeach(
      '我没卖课，也没收徒。就是把踩过的坑，做成别人不用再踩的东西。',
      '我没卖课，也没收徒。只是把踩过的坑，做成别人不用再踩的东西。',
    )).toBe(true);
    expect(isTooSmallToTeach('结果卖了六千多单。', '结果卖出去六千多单。')).toBe(true);
  });

  it('真的换了结构的, 放行', () => {
    expect(isTooSmallToTeach(
      '于是我做了个U盘，把整套环境预装进去，插上就能跑。不用装Python，不用配虚拟机。',
      '我把整套环境预装进U盘，插上就能跑，不用装Python，不用配虚拟机。',
    )).toBe(false);
  });

  it('空的对照不算', () => {
    expect(isTooSmallToTeach('随便写点', '')).toBe(false);
  });
});

describe('looksCopiedFromCompare', () => {
  const mine = '我卡在一个开源项目的第三步，整整两天。装环境、配依赖、改路径，每一步都报新的错。';
  const ai = '我卡在一个开源项目的第三步，整整两天。每一步都报新的错，装环境、配依赖、改路径。';

  it('一个字没动的时候, 绝不能说他抄了 —— 对照版是他的字重排的, 字级重合天然 100%', () => {
    expect(looksCopiedFromCompare({ narration: mine, compare: ai, original: mine })).toBe(false);
  });

  it('真的把对照版抄进去了, 说出来', () => {
    expect(looksCopiedFromCompare({ narration: ai, compare: ai, original: mine })).toBe(true);
  });

  it('自己另外重写的, 不算抄', () => {
    expect(looksCopiedFromCompare({
      narration: '我在一个开源项目上卡了两天，怎么弄都跑不起来。',
      compare: ai, original: mine,
    })).toBe(false);
  });

  it('没有对照版时永远 false', () => {
    expect(looksCopiedFromCompare({ narration: mine, compare: '', original: mine })).toBe(false);
  });
});

describe('对照要认识评分标准', () => {
  it('把这一幕丢的分交给模型', () => {
    const msg = SCRIPT_COMPARE.buildUserMessage({
      acts: [{ act: 'hook', narration: '我卡了两天。' }],
      gaps: { hook: ['念下来 6.8 秒，超出目标 0.8 秒，要删字'] },
    });
    const text = msg.map((p) => ('text' in p ? p.text : '')).join('');
    expect(text).toContain('超出目标 0.8 秒');
  });

  it('有丢分的幕不许说「不用改」—— 那正是用户撞见的自相矛盾', () => {
    expect(SCRIPT_COMPARE.buildSystemPrompt()).toContain('丢分');
  });

  it('没有丢分信息时照旧能用', () => {
    const msg = SCRIPT_COMPARE.buildUserMessage({
      acts: [{ act: 'hook', narration: '我卡了两天。' }],
    });
    expect(msg.map((p) => ('text' in p ? p.text : '')).join('')).toContain('我卡了两天');
  });
});
