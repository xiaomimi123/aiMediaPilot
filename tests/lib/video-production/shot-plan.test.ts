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
   * 二十六期: 实测(电池稿「换电池/换新机」)模型把互斥的二选一标成了 arrow, 应该是
   * versus。之前的说明只罗列了三个值的含义, 没有例子; 这里给每个值配一个具体例子,
   * 并专门点名最容易混的那组。
   */
  it('给 versus/arrow/plus 各配一个具体例子', () => {
    const text = describeCardsForPrompt();
    expect(text).toMatch(/versus.*例|例.*versus/);
    expect(text).toMatch(/arrow.*例|例.*arrow/);
    expect(text).toMatch(/plus.*例|例.*plus/);
  });

  it('专门点名"互斥选项用 versus, 不是 arrow"这个最容易混的判断', () => {
    const text = describeCardsForPrompt();
    expect(text).toContain('互斥');
    expect(text).toMatch(/versus/);
  });
});
