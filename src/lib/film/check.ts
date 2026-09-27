import type { ShotsFile } from './shots';

export interface FilmData {
  durationSec: number;
  captions: { text: string }[];
  materials: { id: string; file: string; mediaType: 'image' | 'video'; durationSec: number | null }[];
}

const EPS = 0.05;
const MIN_SHOT = 1;
const MAX_SHOT = 12;
const MAX_SPEED = 2;
const r = (n: number) => Math.round(n * 100) / 100;

export function checkShots(file: ShotsFile, data: FilmData, publicFiles: Set<string>): string[] {
  const issues: string[] = [];
  const shots = [...file.shots].sort((a, b) => a.fromSec - b.fromSec);
  if (shots.length === 0) return ['镜头表是空的'];
  if (shots[0].fromSec > EPS) issues.push(`第一个镜头要从 0 秒开始，现在是 ${r(shots[0].fromSec)} 秒`);
  shots.forEach((s, i) => {
    const len = s.toSec - s.fromSec;
    if (len < MIN_SHOT) issues.push(`镜头 ${s.id} 只有 ${r(len)} 秒，最短 ${MIN_SHOT} 秒`);
    if (len > MAX_SHOT) issues.push(`镜头 ${s.id} 超过 ${MAX_SHOT} 秒（${r(len)} 秒）`);
    const next = shots[i + 1];
    if (next) {
      const gap = next.fromSec - s.toSec;
      if (gap > EPS) issues.push(`镜头 ${s.id} 与 ${next.id} 之间空了 ${r(gap)} 秒（${r(s.toSec)} → ${r(next.fromSec)}）`);
      if (gap < -EPS) issues.push(`镜头 ${s.id} 与 ${next.id} 重叠了 ${r(-gap)} 秒（${r(s.toSec)} → ${r(next.fromSec)}）`);
    }
    if (s.material) {
      const m = data.materials.find((x) => x.id === s.material!.id);
      if (!m) {
        issues.push(`镜头 ${s.id} 引用了不存在的素材 ${s.material.id}`);
        return;
      }
      if (!publicFiles.has(m.file)) {
        issues.push(`镜头 ${s.id} 用的素材文件不存在：${m.file}`);
        return;
      }
      if (m.mediaType === 'video') {
        const from = s.material.clipFromSec ?? 0;
        const to = s.material.clipToSec ?? m.durationSec ?? from + len;
        const speed = s.material.speed ?? 1;
        if (m.durationSec !== null && to > m.durationSec + EPS) issues.push(`镜头 ${s.id} 截取到 ${r(to)} 秒，素材只有 ${r(m.durationSec)} 秒`);
        if (speed > MAX_SPEED) issues.push(`镜头 ${s.id} 加速 ${speed} 倍，最多 ${MAX_SPEED} 倍`);
        else if ((to - from) / speed > len + EPS)
          issues.push(`镜头 ${s.id} 截取 ${r(to - from)} 秒 ÷ ${speed} 倍 = ${r((to - from) / speed)} 秒，放不进 ${r(len)} 秒的镜头`);
      }
    }
  });
  const last = shots[shots.length - 1];
  if (last.toSec < data.durationSec - EPS) issues.push(`最后一个镜头到 ${r(last.toSec)} 秒结束，口播有 ${r(data.durationSec)} 秒`);
  return issues;
}

/** 文本里的数字(去掉千分位逗号; 百分号不影响数值) */
export function numberTokens(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => s.replace(/,/g, ''));
}

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千', '万'];

/** 0–99999 的简单中文写法(五十、六千、三百零五); 其余返回 null */
export function toChineseNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99999) return null;
  if (n < 10) return DIGITS[n];
  const ds = String(n).split('').map(Number);
  let out = '';
  let zero = false;
  ds.forEach((d, i) => {
    const unit = UNITS[ds.length - 1 - i];
    if (d === 0) {
      zero = out !== '';
      return;
    }
    if (zero) out += '零';
    zero = false;
    out += (d === 1 && unit === '十' && i === 0 ? '' : DIGITS[d]) + unit;
  });
  return out;
}

/** 画面文字(copy.ts 全文)里的每个数字, 必须能在稿子或转写里以阿拉伯数字或中文写法找到 */
export function checkNumbers(copyText: string, sources: string[]): string[] {
  const src = sources.join('\n').replace(/,/g, '');
  const srcNums = new Set(numberTokens(src));
  const issues: string[] = [];
  for (const tok of new Set(numberTokens(copyText))) {
    if (srcNums.has(tok)) continue;
    const cn = toChineseNumber(Number(tok));
    if (cn && src.includes(cn)) continue;
    issues.push(`画面数字 ${tok} 在稿子和转写里都找不到（可能是编造的）`);
  }
  return issues;
}
