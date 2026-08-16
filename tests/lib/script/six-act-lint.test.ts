import { describe, expect, it } from 'vitest';
import { lintSixActScript, type LintIssue } from '@/lib/script/six-act-lint';
import { ACT_KEYS, type ActKey } from '@/lib/script/six-act';

/** 构造一个能通过全部硬检查的最小合法幕。 */
function makeAct(act: ActKey, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    act,
    title: '标题',
    narration:
      act === 'hook'
        ? '揭秘，真相，你绝对想不到'
        : act === 'punchline'
          ? '没想到吧，真相，就是如此'
          : '这是一段正常的口播文案内容',
    visual: '画面提示',
    note: '备注说明',
    targetSec: 10,
    beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
    facts: [],
    ...overrides,
  } as any;
}

function makeValidScript() {
  return {
    acts: ACT_KEYS.map((act) => makeAct(act)),
    four_dims: { gain: '收获', surprise: '意外', clarity: '清晰', appeal: '吸引' },
  };
}

function findIssue(issues: LintIssue[], message: string) {
  return issues.find((i) => i.message.includes(message));
}

describe('lintSixActScript · 结构', () => {
  it('六幕顺序错误 → error', () => {
    const script = makeValidScript();
    [script.acts[0], script.acts[1]] = [script.acts[1], script.acts[0]];
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.level === 'error' && i.act === '结构')).toBe(true);
  });

  it('六幕顺序正确 → 无结构 error', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.act === '结构')).toBe(false);
  });
});

describe('lintSixActScript · 四维', () => {
  it('four_dims 某项为空串 → error', () => {
    const script = makeValidScript();
    script.four_dims.surprise = '';
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '惊喜感为空')?.level).toBe('error');
  });

  it('four_dims 全部非空 → 无四维 error', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.act === '四维')).toBe(false);
  });
});

describe('lintSixActScript · 幕内四件套非空', () => {
  it('title 为空 → error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { title: '' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '标题为空')?.level).toBe('error');
  });

  it('narration 为空 → error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '口播台词为空')?.level).toBe('error');
  });

  it('visual 为空 → error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { visual: '' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '配图建议为空')?.level).toBe('error');
  });

  it('title/narration/visual 均非空 → 无对应 error', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => /为空$/.test(i.message) && i.act === 'concept_a')).toBe(false);
  });
});

describe('lintSixActScript · 数字必须有事实佐证', () => {
  it('narration 含数字但 facts 为空 → error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '这项技术效率提升了 50%' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '事实核查里没有对应条目')?.level).toBe('error');
  });

  it('narration 含数字且 facts.value 覆盖 → 无 error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', {
      narration: '这项技术效率提升了 50%',
      facts: [{ claim: '效率提升', value: '50%', source: '内部测试', confidence: 'high' }],
    });
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('事实核查里没有对应条目'))).toBe(false);
  });

  it('数字识别边界: "2026年" 需要事实佐证', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '这个模型在 2026年 发布' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '2026年')).toBeDefined();
  });

  it('数字识别边界: "第一" 不算断言, 不需要事实佐证', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '它是业内公认的第一选择' });
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('事实核查里没有对应条目'))).toBe(false);
  });

  it('数字识别边界: 小数 "3.5" 需要事实佐证', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '响应速度提升到 3.5 倍' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '3.5')).toBeDefined();
  });
});

describe('lintSixActScript · facts.source 非空', () => {
  it('facts 条目 source 为空 → error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', {
      narration: '效率提升了 50%',
      facts: [{ claim: '效率提升', value: '50%', source: '', confidence: 'high' }],
    });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '没有标注来源')?.level).toBe('error');
  });

  it('facts 条目 source 非空 → 无 error', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', {
      narration: '效率提升了 50%',
      facts: [{ claim: '效率提升', value: '50%', source: '官方报告', confidence: 'high' }],
    });
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('没有标注来源'))).toBe(false);
  });
});

describe('lintSixActScript · hook 开场白', () => {
  it('hook.narration 开头出现寒暄词 → error', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { narration: '大家好, 欢迎观看今天的视频' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '开场出现寒暄')?.level).toBe('error');
  });

  it('hook.narration 开头直接是钩子本身 → 无 error', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('开场出现寒暄'))).toBe(false);
  });
});

describe('lintSixActScript · 空洞形容词', () => {
  it('narration 含空洞形容词 → warn', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '这个效果非常震撼人心' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '空洞形容词')?.level).toBe('warn');
  });

  it('narration 不含空洞形容词 → 无 warn', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('空洞形容词'))).toBe(false);
  });
});

describe('lintSixActScript · 单句过长', () => {
  it('单句超过 30 字 → warn', () => {
    const script = makeValidScript();
    const longSentence = '这是一句非常非常非常非常非常非常非常非常非常非常长的句子超过三十个字了肯定念不出来';
    script.acts[1] = makeAct('concept_a', { narration: longSentence });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '超过 30 字')?.level).toBe('warn');
  });

  it('单句均不超过 30 字 → 无 warn', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('超过 30 字'))).toBe(false);
  });
});

describe('lintSixActScript · 句首悬空指代', () => {
  it('句首出现「这个」→ warn', () => {
    const script = makeValidScript();
    script.acts[1] = makeAct('concept_a', { narration: '这个功能很有用。它解决了实际问题' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '悬空指代')?.level).toBe('warn');
  });

  it('句首不含悬空指代 → 无 warn', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('悬空指代'))).toBe(false);
  });
});

describe('lintSixActScript · 收尾回扣开场', () => {
  it('punchline 与 hook 无 2 字以上共同词 → warn', () => {
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { narration: '苹果树下的意外发现改变世界' });
    script.acts[5] = makeAct('punchline', { narration: '感谢观看希望对你有帮助' });
    const issues = lintSixActScript(script);
    expect(findIssue(issues, '可能没有回扣钩子')?.level).toBe('warn');
  });

  it('punchline 与 hook 有共同词 → 无 warn', () => {
    // 匹配逻辑按标点切出的连续中文串精确比对(与 lint.py 一致), 所以共同词需要
    // 在两侧都被标点独立切出, 而不是内嵌在长句里。
    const script = makeValidScript();
    script.acts[0] = makeAct('hook', { narration: '揭秘，外星人，真的存在吗' });
    script.acts[5] = makeAct('punchline', { narration: '没错，外星人，就在我们身边' });
    const issues = lintSixActScript(script);
    expect(issues.some((i) => i.message.includes('可能没有回扣钩子'))).toBe(false);
  });
});

describe('lintSixActScript · 综合', () => {
  it('全部通过 → 返回空数组', () => {
    const script = makeValidScript();
    const issues = lintSixActScript(script);
    expect(issues).toEqual([]);
  });

  it('error 与 warn 混合时按幕序稳定排列', () => {
    const script = makeValidScript();
    // concept_b(第 3 幕)埋一个 warn(空洞形容词), concept_a(第 2 幕)埋一个 error(标题为空)
    script.acts[1] = makeAct('concept_a', { title: '' });
    script.acts[2] = makeAct('concept_b', { narration: '这个效果非常出色' });
    const issues = lintSixActScript(script);

    const actOrderIndex = (act: string) => {
      const idx = ACT_KEYS.indexOf(act as ActKey);
      return idx === -1 ? ACT_KEYS.length : idx;
    };
    const orderedActs = issues.map((i) => actOrderIndex(i.act));
    const sorted = [...orderedActs].sort((a, b) => a - b);
    expect(orderedActs).toEqual(sorted);

    expect(findIssue(issues, '标题为空')?.act).toBe('concept_a');
    expect(findIssue(issues, '空洞形容词')?.act).toBe('concept_b');
  });
});
