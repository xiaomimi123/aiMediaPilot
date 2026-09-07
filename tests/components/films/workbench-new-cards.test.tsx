import { describe, it, expect } from 'vitest';
import { CARD_TYPES, ShotPlanSchema } from '@/lib/video-production/shot-plan';
import { blankSlots, missingFieldsOfShot,
  slotHasContent, SLOT_LIMITS } from '@/components/films/film-plan-workbench';

/*
 * 这三条测的是「剪辑台对九张卡一视同仁」, 不是某张卡的具体字段。
 * 遍历 CARD_TYPES 而不是手写九个用例 —— 下次再加卡时, 忘了改剪辑台会在这里红,
 * 而不是等用户在界面上把数据编坏了才发现。
 */
describe('剪辑台认得全部九张卡', () => {
  it('blankSlots: 每张卡都给出非空的空槽位, 且字段名与 schema 对得上', () => {
    for (const card of CARD_TYPES) {
      const slots = blankSlots(card);
      expect(Object.keys(slots).length, `${card} 的空槽位是空对象`).toBeGreaterThan(0);
      // 空槽位必填项还没填, 所以整体应当被 schema 拒绝; 但拒绝的理由必须是
      // "必填项太短", 不能是 "多了个不认识的字段"(那说明字段名写错了)。
      const r = ShotPlanSchema.safeParse({ shotId: 's1', startMs: 0, endMs: 3000, card, slots });
      if (!r.success) {
        for (const issue of r.error.issues) {
          expect(issue.code, `${card} 的空槽位字段名与 schema 不符: ${JSON.stringify(issue)}`)
            .not.toBe('unrecognized_keys');
        }
      }
    }
  });

  it('missingFieldsOfShot: 每张卡的空槽位都至少报出一个必填项', () => {
    for (const card of CARD_TYPES) {
      const missing = missingFieldsOfShot({ shotId: 's1', startMs: 0, endMs: 3000, card, slots: blankSlots(card) } as never);
      expect(missing.length, `${card} 的空镜在保存前校验里一个必填项都没报出来`).toBeGreaterThan(0);
    }
  });

  it('SLOT_LIMITS: 九张卡都有字数上限表, 不留兜底', () => {
    for (const card of CARD_TYPES) {
      expect(SLOT_LIMITS, `${card} 没有字数上限`).toHaveProperty(card);
    }
  });
});

describe('换卡前的"已填内容"判断认得数组型槽位', () => {
  /*
   * 三十三期发现的漏洞: slotHasContent 原来只看顶层的字符串与 value 数字。
   * curve/rank/entity 的内容装在数组里(points/rows/chips), 顶层看是个 Array,
   * `typeof v === 'string'` 判 false —— 于是"填了三行排名再换卡"会被当成空镜
   * **静默丢弃, 连确认框都不弹**。这是数据丢失, 不是少个提示。
   *
   * 注意这条测试的写法: 对每张卡的**每一个**必填项, 都单独从空槽位出发只填它一个,
   * 再断言 slotHasContent 为真。最初我只填"第一个"必填项, 结果 curve 的第一个是
   * 顶层的 label(字符串), 填它谁都能判对 —— 变异验证(把数组递归那行删掉)时测试
   * 照样全绿, 等于没测到数组那条路。逐个填才真的走到 points/rows/chips 里面。
   */
  const fillOne = (slots: Record<string, unknown>, field: string) => {
    // 形如 `title` / `rows[0].name` / `points[1].at` / `items[2]`
    const m = field.match(/^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?$/);
    expect(m, `没看懂必填项的写法: ${field}`).toBeTruthy();
    const [, key, idx, sub] = m as RegExpMatchArray;
    if (idx === undefined) slots[key] = '有内容';
    else if (sub === undefined) (slots[key] as unknown[])[Number(idx)] = '有内容';
    else ((slots[key] as Record<string, unknown>[])[Number(idx)])[sub] = '有内容';
  };

  it('每张卡: 空槽位判无内容', () => {
    for (const card of CARD_TYPES) {
      expect(slotHasContent(card, blankSlots(card)), `${card} 的空槽位被误判成有内容`).toBe(false);
    }
  });

  it('每张卡的每一个必填项: 只填它一个, 就该判成有内容', () => {
    for (const card of CARD_TYPES) {
      const fields = missingFieldsOfShot(
        { shotId: 's', startMs: 0, endMs: 3000, card, slots: blankSlots(card) } as never,
      );
      expect(fields.length, `${card} 一个必填项都没报出来`).toBeGreaterThan(0);
      for (const field of fields) {
        const slots = blankSlots(card);
        fillOne(slots, field);
        expect(
          slotHasContent(card, slots),
          `${card} 只填了 ${field} 却仍被判成空镜 —— 换卡会静默丢内容`,
        ).toBe(true);
      }
    }
  });
});
