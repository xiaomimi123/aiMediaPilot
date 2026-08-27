import { ACT_KEYS, ACT_LABELS, ACT_RATIOS, type ActKey } from './six-act';

/**
 * 六幕的时长分配对照(前端重建 · 阶段 4)。
 *
 * 工作区左栏每幕要显示「实际 / 目标」两个数:
 * - **实际** = 稿子里这一幕自己写的 `targetSec`(作者的安排)
 * - **目标** = `ACT_RATIOS × 全片时长`(结构上的理想占比)
 *
 * 两者不是一回事, 这也正是这一栏的价值: 让「我把概念A写成了 15 秒, 而结构上它
 * 只该占 13.5 秒」这件事一眼可见, 而不是等录到一半才发现念不完。
 */

/** 超过目标这个倍数就标 warning。写成常量而不是散在代码里的 1.1。 */
export const OVER_TOLERANCE = 1.1;

interface ActLike {
  act: string;
  targetSec: number;
}

export interface ActPlanRow {
  act: ActKey;
  label: string;
  /** 稿子里这一幕自己写的秒数。 */
  actualSec: number;
  /** 结构上该占的秒数 = ratio × 全片时长。 */
  targetSec: number;
  /** 实际超过目标 10% 以上。 */
  warn: boolean;
  /** 稿子里根本没有这一幕 —— 左栏仍然显示, 但标出来。 */
  missing: boolean;
}

export interface ActPlan {
  rows: ActPlanRow[];
  totalActualSec: number;
  /** 合计超出全片时长多少秒; 没超记 0(不报负数, 短了是另一回事)。 */
  overSec: number;
}

export function buildActPlan(acts: ActLike[], durationSec: number): ActPlan {
  const byKey = new Map(acts.map((a) => [a.act, a]));

  // 顺序固定按 ACT_KEYS 走, 不随输入顺序变 —— 左栏常驻不滚动, 顺序必须稳定
  const rows: ActPlanRow[] = ACT_KEYS.map((key) => {
    const found = byKey.get(key);
    const actualSec = found ? Number(found.targetSec) || 0 : 0;
    const targetSec = ACT_RATIOS[key] * durationSec;
    return {
      act: key,
      label: ACT_LABELS[key],
      actualSec,
      targetSec,
      warn: targetSec > 0 && actualSec > targetSec * OVER_TOLERANCE,
      missing: !found,
    };
  });

  const totalActualSec = rows.reduce((n, r) => n + r.actualSec, 0);
  return {
    rows,
    totalActualSec,
    overSec: Math.max(0, totalActualSec - durationSec),
  };
}
