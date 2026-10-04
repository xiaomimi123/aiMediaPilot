/**
 * 文字排版的纯函数(不依赖 remotion, 主项目 vitest 可直接测)。
 */

/** 显示宽度: 中文/全角算 1, 英文数字半角算 0.55(按字幕字号实测的大致比例) */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch.codePointAt(0)! > 0x2e80 ? 1 : 0.55;
  return Math.round(w * 100) / 100;
}

const PUNCT = '，。！？、；：,.!?;:';
const MIN_LINE = 4;

/**
 * 一行放不下时拆成两行: 优先在靠近中间的标点后断开(两行都放得下、长短差不超过总宽 40%),
 * 否则按宽度对半断; 不拆英文单词, 每行至少 4 个字宽 —— 避免"……干到了第" + "一"这种单字孤行。
 */
export function balanceLines(text: string, maxWidth: number): string[] {
  const chars = Array.from(text);
  const total = displayWidth(text);
  if (total <= maxWidth) return [text];
  const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);
  const candidates: { i: number; diff: number; punct: boolean; fits: boolean }[] = [];
  for (let i = 1; i < chars.length; i++) {
    if (isWord(chars[i - 1]) && isWord(chars[i])) continue;
    const left = displayWidth(chars.slice(0, i).join(''));
    const right = total - left;
    if (left < MIN_LINE || right < MIN_LINE) continue;
    candidates.push({ i, diff: Math.abs(left - right), punct: PUNCT.includes(chars[i - 1]), fits: left <= maxWidth && right <= maxWidth });
  }
  if (candidates.length === 0) return [text];
  const byPunct = candidates.filter((c) => c.punct && c.fits && c.diff <= total * 0.4).sort((a, b) => a.diff - b.diff);
  const best = byPunct[0] ?? [...candidates].sort((a, b) => a.diff - b.diff)[0];
  return [chars.slice(0, best.i).join(''), chars.slice(best.i).join('')];
}

/**
 * 数字卡要不要滚动计数: 只有纯数量(148208、32.5%、3万+)才滚。
 * 比例(9/10)、排名(#1、No.1、TOP 1、第一)、年份(2026)直接显示终值 —— 滚动会闪出"#0""8/10"这类不存在的数。
 */
export function shouldCountUp(value: string): boolean {
  const v = value.trim();
  if (v.includes('/')) return false;
  if (/^(#|no\.|top|第)/i.test(v)) return false;
  const m = /^([+¥$]?)(\d+(?:\.\d+)?)(.*)$/.exec(v);
  if (!m) return false;
  const n = Number(m[2]);
  if (m[3] === '' && Number.isInteger(n) && n >= 1900 && n <= 2100) return false;
  return true;
}

/** 字幕排版: 按字幕区宽度(减去左右内边距 30)从大到小试字号, 取第一个能放进两行的; 给了 maxHeight 时还要求整框(行高 1.3 + 上下内边距 28)不超过它 */
export const CAPTION_FONT_SIZES = [50, 44, 40, 36, 32] as const;
export function captionLayout(text: string, zoneWidth: number, maxHeight?: number): { fontSize: number; rows: string[] } {
  const inner = zoneWidth - 60;
  let last = { fontSize: CAPTION_FONT_SIZES[0] as number, rows: [text] };
  for (const fontSize of CAPTION_FONT_SIZES) {
    const rows = balanceLines(text, inner / fontSize);
    last = { fontSize, rows };
    const fitsWidth = rows.every((r) => displayWidth(r) * fontSize <= inner);
    const fitsHeight = maxHeight === undefined || rows.length * fontSize * 1.3 + 28 <= maxHeight;
    if (fitsWidth && fitsHeight) return last;
  }
  return last;
}
