import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, FilmPlanSchema, CARD_TYPES, describeCardsForPrompt } from '@/lib/video-production/shot-plan';

/*
 * 填槽契约是本期的核心决定(spec §2): Builder 不写代码, 只选卡片 + 填槽位。
 *
 * 这里锁住的是"约束真的存在"——schema 必须拒绝模型的自由发挥, 否则填槽就退化成
 * 另一种形式的自由排版。二十四期的教训: 规则被 100% 遵守、产出 100% 是 PPT,
 * 因为规则本身写的就是 PPT。这次把规则变成 schema, 违反即解析失败。
 */

describe('ShotPlanSchema', () => {
  const base = { shotId: 's1', startMs: 0, endMs: 3000 };

  it('接受合法的 stat 卡', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'stat',
      slots: { label: '月均成交额', value: 900, prefix: '不足 ', suffix: ' 元' },
    });
    expect(r.success).toBe(true);
  });

  it('拒绝未知卡片类型 —— 模型不能发明卡片', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'fancy-3d-globe', slots: {} });
    expect(r.success).toBe(false);
  });

  it('拒绝槽位缺失 —— stat 卡没有 value 就是没填完', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'stat', slots: { label: '只有标签' } });
    expect(r.success).toBe(false);
  });

  it('拒绝多余槽位 —— 模型不能自带私货字段(比如坐标)', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'statement',
      slots: { text: '一句话', x: 200, y: 300 },
    });
    expect(r.success).toBe(false);
  });

  it('拒绝 endMs <= startMs', () => {
    const r = ShotPlanSchema.safeParse({
      shotId: 's1', startMs: 3000, endMs: 3000, card: 'statement', slots: { text: 'x' },
    });
    expect(r.success).toBe(false);
  });

  /*
   * 真机回归(2026-08-31): 提示词没规定 shotId 的类型, 模型把它当"第几镜"填了整数,
   * 修复循环喂回 `Expected string, received number` 两轮都没能让模型改过来——
   * shotId 只是标识符, 不该占用修复循环的额度, 系统兜底把数字转成字符串。
   */
  it('shotId 是数字时自动转成字符串 —— 标识符不该占用修复循环的额度', () => {
    const r = ShotPlanSchema.safeParse({
      shotId: 1, startMs: 0, endMs: 3000, card: 'statement', slots: { text: 'x' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.shotId).toBe('1');
  });

  it('接受合法的 contrast 卡 —— 不再需要 connector', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'contrast',
      slots: { leftLabel: '技术', leftText: '人人可得', rightLabel: '提问', rightText: '拉开差距' },
    });
    expect(r.success).toBe(true);
  });

  /*
   * 二十八期兜底: 改动之前落库的 filmPlan 里, contrast 槽位带着旧方案的
   * connector 字段。这些历史数据在 master 渲染时还要能解析成功——不能因为
   * 一个已经废弃的字段让老片子渲不出来。这里锁住两件事: ①带 connector 的
   * 旧数据仍能解析成功, ②解析结果里不再带 connector 这个字段(不是"容忍
   * 多余字段"，是"丢弃这一个已知的历史字段"，其它多余字段仍然要被拒绝)。
   */
  it('contrast 槽位带着历史遗留的 connector 字段仍能解析, 且解析结果里丢掉了它', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'contrast',
      slots: {
        leftLabel: '技术', leftText: '人人可得', rightLabel: '提问', rightText: '拉开差距',
        connector: 'arrow',
      },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.card === 'contrast') {
      expect(r.data.slots).not.toHaveProperty('connector');
    }
  });

  it('contrast 槽位真正未知的字段(不是历史 connector)仍然被拒绝', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'contrast',
      slots: {
        leftLabel: '技术', leftText: '人人可得', rightLabel: '提问', rightText: '拉开差距',
        somethingElse: 'x',
      },
    });
    expect(r.success).toBe(false);
  });
});

/*
 * 这组测的不是"拒不拒绝"，是**报错报得对不对**。
 *
 * 曾用 z.union，`stat.value` 填成字符串时报的是 invalid_union，里面并排装着四个分支
 * 的失败；排第一的 statement 分支写着「expected "statement"」+「Unrecognized key(s):
 * 'label','value','suffix'」。实测三条真实稿子，模型把这段读成"这镜该用 statement"，
 * 于是整张 stat 卡被放弃，存活率 0/3。错误信息是修复循环的输入，所以它属于契约本身。
 */
describe('ShotPlanSchema 的报错必须可执行', () => {
  const statShot = {
    shotId: 's1', startMs: 0, endMs: 3000, card: 'stat',
    slots: { label: '涨幅', value: '300-500', suffix: '元' },
  };

  it('value 类型错时只报 value 这一条, 不报成 invalid_union', () => {
    const r = ShotPlanSchema.safeParse(statShot);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0].code).toBe('invalid_type');
    expect(r.error.issues[0].path).toEqual(['slots', 'value']);
  });

  it('不许出现"改用别的卡片"这类会把模型带偏的字样', () => {
    const r = ShotPlanSchema.safeParse(statShot);
    if (r.success) throw new Error('这份数据本该解析失败');
    const text = JSON.stringify(r.error.issues);
    expect(text).not.toContain('statement');
    expect(text).not.toContain('Unrecognized key');
  });
});

describe('FilmPlanSchema', () => {
  const shot = (id: string, a: number, b: number) => ({
    shotId: id, startMs: a, endMs: b, card: 'statement' as const, slots: { text: id },
  });

  it('接受时间轴连续、不重叠的分镜', () => {
    const r = FilmPlanSchema.safeParse({ shots: [shot('a', 0, 1000), shot('b', 1000, 2000)] });
    expect(r.success).toBe(true);
  });

  it('拒绝时间轴重叠 —— 两镜同时在演是我们自建管线查不出的那类结构问题', () => {
    const r = FilmPlanSchema.safeParse({ shots: [shot('a', 0, 1500), shot('b', 1000, 2000)] });
    expect(r.success).toBe(false);
  });

  it('拒绝空分镜', () => {
    expect(FilmPlanSchema.safeParse({ shots: [] }).success).toBe(false);
  });
});

describe('describeCardsForPrompt', () => {
  it('每种卡片都出现在给导演的说明里 —— 漏一种模型就永远不会选它', () => {
    const text = describeCardsForPrompt();
    for (const t of CARD_TYPES) expect(text).toContain(t);
  });

  it('说明里写了"什么时候用", 不只是列字段', () => {
    expect(describeCardsForPrompt()).toMatch(/什么时候用|用在/);
  });

  /*
   * 二十六期: 加例子的修法只对"点名过的那对"有效; 二十七期换成可判定的规程
   * (先问"同一主体+不同时间点", 再问能否同时成立分 plus/versus)。
   *
   * 二十八期把这整条路推翻了: 三轮真机实测(3 条真实六幕稿 × 3 遍)显示总正确率
   * 在 61%~70% 之间来回摆, 且每轮现象一致——收紧规则让一个取值变准, 错误就整批
   * 迁移到另一个取值上, 是零和搬运不是判断力提升。选错连接符等于画面断言了一个
   * 原文没有的关系, 比不断言更糟, 所以拍板去掉 connector 这道选择, 不再要求模型
   * 判断 arrow/versus/plus。下面这组测试锁住"新说明里已经不提这套判定规程,
   * 只交代中性分隔件"。
   */
  it('不再要求模型判断 arrow/versus/plus —— 连接符已从槽位里去掉', () => {
    const text = describeCardsForPrompt();
    expect(text).not.toContain('connector');
    expect(text).not.toMatch(/`arrow`|`versus`|`plus`/);
  });

  it('contrast 的说明交代了"中性分隔件"以及为什么不再判断关系', () => {
    const text = describeCardsForPrompt();
    expect(text).toMatch(/中性/);
    expect(text).toMatch(/零和搬运|不需要.*关系|不能指定.*关系/);
  });
});
