import { describe, it, expect } from 'vitest';
import { CARD_TYPES, ShotPlanSchema } from '@/lib/video-production/shot-plan';
import { blankSlots, missingFieldsOfShot, SLOT_LIMITS } from '@/components/films/film-plan-workbench';

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
