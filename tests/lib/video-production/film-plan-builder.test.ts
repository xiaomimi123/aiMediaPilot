import { describe, it, expect } from 'vitest';
import { buildFilmPlan, formatIssuesForModel, describeZodIssues, MAX_REPAIR_ROUNDS } from '@/lib/video-production/film-plan-builder';
import type { ActWindow } from '@/lib/video-production/film-plan-prompt';

const windows: ActWindow[] = [
  { act: 'hook', title: '钩子', startMs: 0, endMs: 10000, narration: '刷到过三天赚五千吗' },
];

const good = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'statement', slots: { text: '三天赚五千?' } }] };
// value 是字符串 —— 正是探针里模型真实犯过的那个错
const badValue = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'stat', slots: { label: '成交额', value: '900' } }] };
const gap = { shots: [
  { shotId: 's1', startMs: 0, endMs: 4000, card: 'statement', slots: { text: '一' } },
  { shotId: 's2', startMs: 6000, endMs: 10000, card: 'statement', slots: { text: '二' } },
] };

/** 按顺序吐出预设答案的假 LLM, 并记下每次收到的 user message。 */
const fakeLLM = (responses: unknown[], usages: unknown[] = []) => {
  const remaining = [...responses];
  const remainingUsages = [...usages];
  const seen: string[] = [];
  return {
    seen,
    callStructured: async (opts: any) => {
      seen.push(opts.userMessage.map((p: any) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: remainingUsages.shift() ?? {} };
    },
  };
};

describe('formatIssuesForModel', () => {
  it('逐条列出, 不夹带别的卡片类型的噪音', () => {
    const text = formatIssuesForModel(['A 有问题', 'B 有问题']);
    expect(text).toContain('A 有问题');
    expect(text).toContain('B 有问题');
    expect(text).not.toContain('invalid_union');
  });
});

/*
 * 「模型不碰 style」的第二重保证(三十二期 Task 2)必须在**集成路径**上钉住。
 *
 * 变异实测: 只对 stripPlanStyle 做纯函数单测时, 把 buildFilmPlan 里那句调用
 * 整个删掉, 测试照样全绿 —— 纯函数是对的、却没人验证它真的被调用了。
 * 这条用假 LLM 吐一份带 style 的 plan(模拟模型意外填了), 断言 buildFilmPlan
 * 的产出里 style 已被剥掉。
 */
describe('buildFilmPlan 剥掉模型产出的 style', () => {
  const withStyle = { shots: [{
    shotId: 's1', startMs: 0, endMs: 10000, card: 'statement',
    slots: { text: '三天赚五千?' }, style: { speed: 2, accent: 'red' },
  }] };

  it('模型意外填了 style 也不会进入产出', async () => {
    const llm = fakeLLM([withStyle]);
    const r = await buildFilmPlan({
      llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000,
    });
    expect(r.rounds).toBe(0);
    expect(r.plan.shots[0]).not.toHaveProperty('style');
    // 其余字段原样保留 —— 剥的是 style, 不是把整条镜头重建
    expect(r.plan.shots[0].slots).toEqual({ text: '三天赚五千?' });
  });
});

describe('buildFilmPlan', () => {
  it('一次就对时不重试', async () => {
    const llm = fakeLLM([good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(0);
    expect(r.plan.shots).toHaveLength(1);
    expect(llm.seen).toHaveLength(1);
  });

  it('schema 错误被喂回后收敛, 且喂回的是精准的那一条', async () => {
    const llm = fakeLLM([badValue, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('slots.value');
    // 关键: 不许把"这镜该用 statement"这类会让模型弃卡的噪音喂回去
    expect(llm.seen[1]).not.toContain('Unrecognized key');
    expect(llm.seen[1]).not.toContain('expected "statement"');
  });

  it('时间轴空档也会被喂回', async () => {
    const llm = fakeLLM([gap, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('4000');
    expect(llm.seen[1]).toContain('6000');
  });

  it('修满 MAX_REPAIR_ROUNDS 仍不对就抛错, 错误里带最后一轮的问题', async () => {
    const llm = fakeLLM([badValue, badValue, badValue]);
    await expect(
      buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 }),
    ).rejects.toThrow(/slots\.value/);
    expect(llm.seen).toHaveLength(MAX_REPAIR_ROUNDS + 1);
  });

  it('修复轮的 userMessage 带上原始台词/时间窗, 不只是 issue 文本', async () => {
    // 根因回归: 之前修复轮的 userMessage 整个替换成 issue 文本, 模型看不到原始
    // 台词和时间窗, 稿子长了以后会凭空编出短得多的方案。见 buildFilmPlan 里
    // `originalUserMessage` 的注释(180 秒六幕稿真机复现)。
    const llm = fakeLLM([badValue, good]);
    await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(llm.seen[1]).toContain('刷到过三天赚五千吗');
    expect(llm.seen[1]).toContain('slots.value');
  });

  it('completionTokens 逼近 maxTokens 时判定为截断, 直接抛错(不进修复循环)', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 7900 }]);
    await expect(
      buildFilmPlan({
        llm: llm as any,
        windows,
        cardsSection: '卡片说明',
        factsSection: '',
        totalMs: 10000,
        maxTokens: 8192,
      }),
    ).rejects.toThrow(/截断/);
    // 只调了一次, 没有把截断产物喂进修复循环白烧轮次
    expect(llm.seen).toHaveLength(1);
  });

  it('不传 maxTokens 就不做截断检测(历史行为不变)', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 999999 }]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(0);
  });

  it('completionTokens 远低于 maxTokens 时不误判', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 200 }]);
    const r = await buildFilmPlan({
      llm: llm as any,
      windows,
      cardsSection: '卡片说明',
      factsSection: '',
      totalMs: 10000,
      maxTokens: 8192,
    });
    expect(r.rounds).toBe(0);
  });
});

describe('describeZodIssues: 有既定处置办法的问题, 报错要说那个办法', () => {
  /*
   * 三十三期实测: 45 次真实运行里整片失败 10 次, 头号原因是 `list` 条目不足 3 条(5 次) ——
   * 而且是**两轮修复之后仍然失败**。
   *
   * 根因不是模型笨, 是两句话打架。提示词里写着「凑不满 3 条(items 下限)就换用 statement,
   * 宁可用一句真话, 也不要用编出来的第四条」; 而修复循环喂回去的是 zod 原文
   * 「Array must contain at least 3 element(s)」—— 那句话的字面意思是"再加一条"。
   * 模型听了更近、更具体的那句去凑数, 可事实纪律又不许它编, 于是反复过不去。
   *
   * 这与二十七期 z.union 那次是同一类: **报错措辞是契约, 不是日志**。
   * 所以对"提示词里已经规定了处置办法"的那几种问题, 报错必须复述那个办法。
   */
  const shot = (card: string, slots: unknown) => ({ shotId: 's1', startMs: 0, endMs: 4000, card, slots });

  it('list 条目不足: 报错要说改用 statement, 而不是"再加一条"', () => {
    const issues = describeZodIssues({ shots: [shot('list', { title: '两点', items: ['第一条', '第二条'] })] });
    const text = issues.join('\n');
    expect(text, '要说出处置办法').toContain('statement');
    // 断言的是「明确禁止编造」这个意图, 不是某个具体词。写死一个词会在措辞微调时
    // 假红, 但放到只查"编"字又会被"编排"之类的词蒙混 —— 取「否定 + 凑/编」的组合。
    expect(text, '要点明不许为了凑数而编造').toMatch(/不(要|许)[^。]*(凑|编)/);
    expect(text, '要指出是哪一镜').toContain('shots.0');
  });

  it('list 条目不足: 不许把 zod 原文原样透传 —— 那句话在教它凑数', () => {
    const text = describeZodIssues({ shots: [shot('list', { title: '两点', items: ['一', '二'] })] }).join('\n');
    expect(text).not.toContain('at least 3 element');
  });

  it('没有既定处置办法的问题, 仍然照原样报(不要为了统一而含糊化)', () => {
    // label 超长是能直接改短的, 没有"换一张卡"这种处置, 报原文即可
    const text = describeZodIssues({ shots: [shot('stat', { label: '这个标签特别特别特别特别长超过十六个字了', value: 1 })] }).join('\n');
    expect(text).toContain('shots.0.slots.label');
    expect(text.length).toBeGreaterThan(10);
  });
});

describe('describeZodIssues: 超长字段的报错要带实际值(三十八期真实故障的回归)', () => {
  /*
   * 用户第一次用月度规划出片就撞上: rank 卡 rows[].name 超 12 字、contrast 的
   * rightText 超 16 字, 修复循环 2 轮救不回来, 整片失败。三十三期曾判定
   * "超长类报错能直接改短、保持 zod 原文" —— 被这次实测证伪: 模型面对
   * "String must contain at most 12 character(s)" 两轮都修不好, 因为它看不到
   * **自己写的是什么、超了多少** —— 修复指令必须带实际值、实际字数、目标字数。
   */
  const shot = (card: string, slots: unknown) => ({ shotId: 's1', startMs: 0, endMs: 4000, card, slots });

  it('rank 行名超长: 报出实际值与字数, 给压缩指令', () => {
    const text = describeZodIssues({
      shots: [shot('rank', {
        title: '需求分布',
        rows: [
          { name: '四线城市', value: 32 },
          { name: '自由职业者和小微创业者朋友们', value: 27 },
        ],
      })],
    }).join('\n');
    expect(text).toContain('自由职业者和小微创业者朋友们'); // 实际值
    expect(text).toContain('14');                      // 实际字数
    expect(text).toContain('12');                      // 上限
    expect(text).toMatch(/压缩|缩短|改短/);            // 可执行指令
    expect(text).not.toContain('String must contain'); // 不再透传 zod 原文
  });

  it('contrast 文本超长: 同样带实际值与字数', () => {
    const long = '这一段右侧文本实在是太长了明显超过十六个字';
    const text = describeZodIssues({
      shots: [shot('contrast', {
        leftLabel: '以前', leftText: '手动回复', rightLabel: '现在', rightText: long,
      })],
    }).join('\n');
    expect(text).toContain(long);
    expect(text).toContain(String(long.length));
    expect(text).toMatch(/压缩|缩短|改短/);
  });
});

describe('槽位限长按显示宽度而非字符数(第二次真实出片失败的回归)', () => {
  /*
   * 模型写了「EnterpriseOps-Gym」(17 字符)当 contrast 标签, 被 max(12) 拒掉,
   * 修复循环里模型压不短 —— 专名压短就不是那个名字了。17 个半角字符显示宽度
   * 只有 8.5, 画面放得下; 限长的本意是"画面放得下", 改按宽度算。
   */
  const shot = (card: string, slots: unknown) => ({ shotId: 's1', startMs: 0, endMs: 4000, card, slots });

  it('英文专名 EnterpriseOps-Gym(17 字符/宽 8.5)不再被 12 上限拒掉', () => {
    const text = describeZodIssues({
      shots: [shot('contrast', {
        leftLabel: '通用测试集', leftText: '任务成功率 46%',
        rightLabel: 'EnterpriseOps-Gym', rightText: '任务成功率 71%',
      })],
    }).join('\n');
    expect(text).not.toContain('rightLabel');
    expect(text).not.toContain('EnterpriseOps-Gym');
  });

  it('中文超宽仍然拦, 报错带实际值/宽度/上限', () => {
    const text = describeZodIssues({
      shots: [shot('contrast', {
        leftLabel: '这个标签明显超过十二个汉字的宽度了', leftText: '手动回复',
        rightLabel: '现在', rightText: '自动回复',
      })],
    }).join('\n');
    expect(text).toContain('这个标签明显超过十二个汉字的宽度了');
    expect(text).toContain('17'); // 17 个汉字宽 17
    expect(text).toContain('12');
    expect(text).toMatch(/压缩|缩短|改短/);
  });
});
