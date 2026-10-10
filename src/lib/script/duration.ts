import { ROLE_LABEL, ROLE_SHARE, type Script, type SegmentRole } from './model';

/** 中文口播语速(字/秒)。旧版稿子页实测口径 49 字 ≈ 9.8 秒。阶段 5 用已发作品校准。 */
export const CHARS_PER_SEC = 5;
/** 单段允许超出预算的比例 */
export const SEGMENT_TOLERANCE = 1.25;
/** 全片允许超出目标的比例 */
export const TOTAL_TOLERANCE = 1.1;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 念出来的"字数": 汉字各算 1; 连续的英文/数字按 ceil(长度/3) 算; 标点与空白不算。 */
export function countSpokenChars(text: string): number {
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).reduce((n, w) => n + Math.ceil(w.length / 3), 0);
  return cjk + latin;
}

export function estimateSec(text: string): number {
  return round1(countSpokenChars(text) / CHARS_PER_SEC);
}

export function segmentBudgetSec(role: SegmentRole, targetSec: number): number {
  return round1(targetSec * ROLE_SHARE[role]);
}

export interface SegmentReport {
  id: string;
  index: number;
  role: SegmentRole;
  estSec: number;
  budgetSec: number;
  limitSec: number;
  over: boolean;
}

export interface DurationReport {
  totalSec: number;
  targetSec: number;
  totalLimitSec: number;
  ok: boolean;
  segments: SegmentReport[];
  /** 全片超标说明(只有它触发自修), 必须带实际值(模型拿不到数值就只能盲改) */
  issues: string[];
  /** 单段明显偏长的提示: 每段字数只作参考, 不算超标 */
  hints: string[];
}

export function checkDuration(script: Script, targetSec: number): DurationReport {
  const segments = script.segments.map((s, i): SegmentReport => {
    const estSec = estimateSec(s.text);
    const budgetSec = segmentBudgetSec(s.role, targetSec);
    const limitSec = round1(budgetSec * SEGMENT_TOLERANCE);
    return { id: s.id, index: i + 1, role: s.role, estSec, budgetSec, limitSec, over: estSec > limitSec };
  });
  const totalSec = round1(segments.reduce((n, s) => n + s.estSec, 0));
  const totalLimitSec = round1(targetSec * TOTAL_TOLERANCE);
  const hints = segments
    .filter((s) => s.over)
    .map((s) => `第${s.index}段「${ROLE_LABEL[s.role]}」约 ${s.estSec} 秒，参考 ${s.budgetSec} 秒（约 ${Math.round(s.budgetSec * CHARS_PER_SEC)} 字）`);
  const issues = totalSec > totalLimitSec ? [`全片约 ${totalSec} 秒，目标 ${targetSec} 秒（上限 ${totalLimitSec} 秒） —— 删到约 ${Math.floor(totalLimitSec * CHARS_PER_SEC)} 字以内`] : [];
  return { totalSec, targetSec, totalLimitSec, ok: issues.length === 0, segments, issues, hints };
}
