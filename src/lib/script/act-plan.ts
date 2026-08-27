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

/**
 * 中文口播的舒适语速(字/秒)。取提词器里 COMFORTABLE_SPEED {4,6} 的中值。
 * 「实际时长」由字数换算而来, 所以这个数直接决定左栏显示的秒数。
 */
export const SPEAKING_CHARS_PER_SEC = 5;

/** 标点不出声, 不计入字数。 */
function countSpokenChars(text: string): number {
  return (text ?? '').replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）]/g, '').length;
}

/** 这段台词按舒适语速要念多少秒。 */
export function estimateSpokenSec(narration: string): number {
  return countSpokenChars(narration) / SPEAKING_CHARS_PER_SEC;
}

/** 只读用得上的三个字段。调用方通常直接给完整 ScriptAct, 多出来的字段忽略。 */
interface ActLike {
  act: string;
  narration?: string;
  targetSec?: number;
}

export interface ActPlanRow {
  act: ActKey;
  label: string;
  /**
   * 这一幕**按字数估**要念多少秒。
   *
   * 不用稿子里写的 `targetSec`: 那是模型当初的安排, 你改了台词它不会变。按字数估
   * 才会随打字实时变化 —— 这是「快回路」里最有用的一条反馈。
   */
  actualSec: number;
  /** 这一幕的字数(不含标点)。旁白框右上角直接显示。 */
  chars: number;
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

export function buildActPlan(acts: readonly Readonly<ActLike>[], durationSec: number): ActPlan {
  const byKey = new Map(acts.map((a) => [a.act, a]));

  // 顺序固定按 ACT_KEYS 走, 不随输入顺序变 —— 左栏常驻不滚动, 顺序必须稳定
  const rows: ActPlanRow[] = ACT_KEYS.map((key) => {
    const found = byKey.get(key);
    const chars = found ? countSpokenChars(found.narration ?? '') : 0;
    const actualSec = chars / SPEAKING_CHARS_PER_SEC;
    const targetSec = ACT_RATIOS[key] * durationSec;
    return {
      act: key,
      label: ACT_LABELS[key],
      actualSec,
      chars,
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
