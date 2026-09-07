import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, CARD_TYPES, describeCardsForPrompt } from '@/lib/video-production/shot-plan';

const base = { shotId: 's1', startMs: 0, endMs: 4000 };

describe('五张新卡的 schema', () => {
  it('CARD_TYPES 扩到 9 张', () => {
    expect(CARD_TYPES).toEqual([
      'statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity',
    ]);
  });

  it('ring: 合法通过; max 缺省为 100', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '四线城市占比', value: 32.2, unit: '%' } });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { slots: { max: number } }).slots.max).toBe(100);
  });

  it('odometer: value 必须是整数', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 11000 } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 32.2 } }).success).toBe(false);
  });

  it('curve: points 少于 3 个被拒, 多于 8 个被拒', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ at: `第${i}月`, value: i * 10 }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(2) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(3) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(9) } }).success).toBe(false);
  });

  it('curve: 数组元素也是 strict —— 点里多一个字段就失败', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'curve',
      slots: { label: '增长', points: [{ at: '1月', value: 1, color: 'red' }, { at: '2月', value: 2 }, { at: '3月', value: 3 }] },
    });
    expect(r.success).toBe(false);
  });

  it('rank: rows 2~6 项', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `第${i}名`, value: 100 - i }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(1) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(2) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(7) } }).success).toBe(false);
  });

  it('entity: chips 1~3 块, tone 只认 light/dark', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'DeepSeek', tone: 'dark' }] } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'X', tone: 'blue' }] } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [] } }).success).toBe(false);
  });

  it('报错仍然精准 —— 单一分支的问题, 不是四个分支的并列噪音', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '占比', value: '32.2' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0].path).toEqual(['slots', 'value']);
    }
  });
});

describe('九张卡的说明', () => {
  const text = describeCardsForPrompt();

  it('每张卡都有一段说明', () => {
    for (const t of ['statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity']) {
      expect(text, `${t} 缺说明`).toContain(`\`${t}\``);
    }
  });

  it('容易混的四对都写了可判定的界线', () => {
    expect(text).toContain('有分母');      // ring vs stat
    expect(text).toContain('必须是整数');  // odometer vs stat
    expect(text).toContain('不讲中间过程'); // curve vs contrast
    expect(text).toContain('不比大小');    // rank vs list
  });

  it('卡片说明里不提 style/坐标/颜色 —— 那些不归模型管', () => {
    /*
     * 只查卡片说明那几行(以 `- \`` 开头的), 不查整段提示词。
     * 我最初写成 `expect(text).not.toMatch(...)` 查全文, 结果被三十二期就有的
     * 收尾句「不要输出坐标、颜色、字号、动画参数」判红 —— 那句话恰恰是在**禁止**
     * 模型输出这些, 与本条的意图同向。断言写得比意图宽, 就会把满足意图的写法也判成
     * 违规。改成只查卡片说明本身: 一张卡的介绍里不该出现视觉参数, 全局禁令则该出现。
     */
    const cardLines = text.split('\n').filter((l) => l.trimStart().startsWith('- `'));
    expect(cardLines.length).toBeGreaterThanOrEqual(9);
    for (const line of cardLines) {
      expect(line, `卡片说明里出现了视觉参数: ${line}`).not.toMatch(/style|accent|坐标|字号/);
    }
  });
});
