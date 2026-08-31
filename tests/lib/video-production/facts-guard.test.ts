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

describe('素材铺排(二十一期 A2)', () => {
  const brief = {
    points: [
      { fact: 'DeepSeek V4 高峰时段单价为平时的 4 倍', source: 'https://wsj.com/a', usage: '澄清涨幅' },
      { fact: '本轮融资 74 亿美元', source: 'https://wsj.com/b', usage: '说明不缺钱' },
    ],
  };

  it('研究简报的事实点进清单, 带来源', () => {
    const s = buildFactsSection([act({ facts: [] })], brief);
    expect(s).toContain('高峰时段单价为平时的 4 倍');
    expect(s).toContain('wsj.com/a');
  });

  it('明确要求画面优先铺这些真实文字, 而不是画抽象图形', () => {
    const s = buildFactsSection([act({ facts: [] })], brief);
    expect(s).toMatch(/优先.*铺|优先.*真实|不要.*抽象|抽象图形/);
  });

  it('不给简报时行为与之前一致(只有六幕 facts)', () => {
    const withoutBrief = buildFactsSection([act({ facts: [] })]);
    const withNull = buildFactsSection([act({ facts: [] })], null);
    expect(withNull).toBe(withoutBrief);
  });

  it('简报与六幕 facts 同时存在时都列出来', () => {
    const s = buildFactsSection(
      [act({ facts: [{ claim: '融资额', value: '74 亿美元', source: 'WSJ', confidence: 'high' }] })],
      brief,
    );
    expect(s).toContain('74 亿美元');
    expect(s).toContain('高峰时段单价为平时的 4 倍');
  });

  it('空简报(points 为空)等同于没有简报', () => {
    const s = buildFactsSection([act({ facts: [] })], { points: [] });
    expect(s).toBe(buildFactsSection([act({ facts: [] })]));
  });
});

describe('版面模板(压排版能力)', () => {
  const s = () => buildFactsSection([act({ facts: [] })], {
    points: [
      { fact: 'A 事实', source: 'a', usage: 'x' },
      { fact: 'B 事实', source: 'b', usage: 'y' },
    ],
  });

  // 二十二期: 版面骨架换成构图契约后, 这条断言随之改成校验"给出可直接照做的构图契约"
  // (原断言直接检测「左右分栏/骨架/版面」这类幻灯片语汇, 与本次要移除的东西字面冲突)。
  it('给出可直接照做的构图契约, 而不是只说"可以放多块"', () => {
    expect(s()).toMatch(/构图契约|evidence|relation|volume/);
  });

  it('要求每个区块内部有层次(标题+要点), 不是并排放两个大字', () => {
    expect(s()).toMatch(/层次|小标题.*要点|要点/);
  });

  it('给出一屏信息块数量的下限, 不能一屏只放一句话', () => {
    expect(s()).toMatch(/至少|不少于/);
  });

  it('明确禁止大面积留白撑版面', () => {
    expect(s()).toMatch(/留白|空/);
  });

  it('没有素材时不强推密度 —— 硬凑会退化成编造', () => {
    const empty = buildFactsSection([act({ facts: [] })]);
    expect(empty).not.toMatch(/至少|不少于/);
  });
});

// 二十二期: 实测确认上一版「版面骨架」被 100% 照做, 但写的就是幻灯片构件
// (圆角浅色卡 + 顶部小标题 + 带图标要点行), 所以产出 100% 是 PPT。规则本身要换掉,
// 换成三种构图契约(evidence / relation / volume)。下面这批用例复用文件里已有的
// act() 工厂(默认 facts: [] ), 用 act({ facts: [...] }) 造出「有 N 条 high fact」的幕。
describe('版面骨架换成构图契约', () => {
  const actsWithHighFacts = (n: number): ScriptAct[] => [
    act({
      facts: Array.from({ length: n }, (_, i) => ({
        claim: `事实${i}`,
        value: `${i}00元`,
        source: '来源',
        confidence: 'high' as const,
      })),
    }),
  ];

  it('不再用幻灯片语汇 —— 「圆角浅色卡 + 小标题 + 要点行」本来就是 PPT 的构件', () => {
    const s = buildFactsSection(actsWithHighFacts(3));
    expect(s).not.toContain('圆角浅色卡');
    expect(s).not.toContain('带图标的要点');
  });

  it('给出三种构图契约, 并说清各自用在什么时候', () => {
    const s = buildFactsSection(actsWithHighFacts(3));
    for (const k of ['evidence', 'relation', 'volume']) expect(s).toContain(k);
    expect(s).toContain('连接符');
  });

  it('料不够时不给构图契约 —— 没素材还压密度, 模型只会靠编来填满', () => {
    const s = buildFactsSection(actsWithHighFacts(1));
    expect(s).not.toContain('evidence');
  });

  it('relation 的连接符与事实纪律不冲突: 只许画 claim 本身的逻辑关系', () => {
    const s = buildFactsSection(actsWithHighFacts(3));
    // 事实纪律那条「不许做箭头图」是防**从数据里编因果**, 不是禁止一切连接符
    expect(s).toContain('镜头 claim 本身');
  });

  it('事实纪律照旧保留 —— 换构图不等于放开编数字', () => {
    const s = buildFactsSection(actsWithHighFacts(3));
    expect(s).toContain('画面事实纪律');
    expect(s).toContain('清单之外的任何数字');
  });
});

/*
 * 二十六期: `mode` 参数。根因(见 spike-builder-filmplan.md 复跑记录)——旧链"构图契约"
 * 里的 volume 一项写着"条目数不少于 8 条", 而填槽链 `list` 卡的 schema 是 3~8 条、
 * 固定版面。同一段文案套在两条链上, 旧链是"密度建议", 新链变成"提示词要求不少于 8
 * 条、schema 上限是 8"的自相矛盾指令——实测三条真实稿子的 list 卡都在凑数。
 *
 * 默认值 `'freeform'` 必须与不传第三个参数时完全一致(旧调用方零改动); `'cards'` 模式
 * 才换成与固定卡片一致的措辞。
 */
describe('mode 参数(二十六期): 旧链 freeform 不变, 新链 cards 换掉冲突措辞', () => {
  const actsWithHighFacts = (n: number) => [
    {
      act: 'hook', title: '标题', narration: '台词', visual: '画面', note: '备注', targetSec: 10,
      beats: [{ keyword: 'k1' }],
      facts: Array.from({ length: n }, (_, i) => ({
        claim: `事实${i}`, value: `${i}00元`, source: '来源', confidence: 'high' as const,
      })),
    },
  ] as unknown as ScriptAct[];

  it('不传 mode 时与传 "freeform" 字符级一致', () => {
    const acts = actsWithHighFacts(3);
    expect(buildFactsSection(acts)).toBe(buildFactsSection(acts, undefined, 'freeform'));
  });

  it('不传 mode 时的输出与改动前完全一致(回归防线): 仍含"不少于 8 条"与"一屏可以放多块信息"', () => {
    const s = buildFactsSection(actsWithHighFacts(3));
    expect(s).toContain('不少于 8 条');
    expect(s).toContain('一屏可以放多块信息');
  });

  it('cards 模式不再出现"不少于 8 条"这类跟固定卡片版面冲突的密度要求', () => {
    const s = buildFactsSection(actsWithHighFacts(3), undefined, 'cards');
    expect(s).not.toContain('不少于 8 条');
    expect(s).not.toContain('一屏可以放多块信息');
    expect(s).not.toContain('一屏只放一句话');
  });

  it('cards 模式明确要求 list 条目必须有出处, 凑不满 3 条就改用 statement', () => {
    const s = buildFactsSection(actsWithHighFacts(3), undefined, 'cards');
    expect(s).toContain('list');
    expect(s).toMatch(/出处/);
    expect(s).toContain('statement');
    expect(s).toMatch(/不许.*编造|不要.*编造/);
  });

  it('cards 模式下事实纪律与事实清单本体照旧保留(只换构图/密度措辞)', () => {
    const s = buildFactsSection(actsWithHighFacts(3), undefined, 'cards');
    expect(s).toContain('画面事实纪律');
    expect(s).toContain('清单之外的任何数字');
  });

  it('料不够(entries < 2)时 cards 模式同样不给密度/构图指令', () => {
    const acts = actsWithHighFacts(1);
    const s = buildFactsSection(acts, undefined, 'cards');
    expect(s).not.toContain('选卡与填槽纪律');
  });
});
