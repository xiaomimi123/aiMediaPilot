import type { ShotsFile } from './shots';
import { isFilmOrientation, orientationLabel, type FilmOrientation } from './orientation';

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

const CN_NUM = '零一二两三四五六七八九十百千万';
const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 源码里的字符串字面量内容('…' "…" `…`); 只查画面文字, 不查键名和标识符 */
export function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** 简单中文数字 → 数值(支持 万/千/百/十 与 两); 解析不了返回 null */
export function parseChineseNumber(s: string): number | null {
  const section = (t: string): number | null => {
    if (t === '') return 0;
    let total = 0;
    let digit = -1;
    for (const ch of t) {
      if (ch in CN_DIGIT) digit = CN_DIGIT[ch];
      else if (ch === '十' || ch === '百' || ch === '千') {
        const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
        total += (digit < 0 ? 1 : digit) * unit;
        digit = -1;
      } else return null;
    }
    return total + (digit > 0 ? digit : 0);
  };
  const parts = s.split('万');
  if (parts.length > 2) return null;
  const high = parts.length === 2 ? section(parts[0] || '一') : 0;
  const low = section(parts[parts.length - 1]);
  if (high === null || low === null) return null;
  return (high ?? 0) * 10000 + low;
}

/** 中文写法(含"两"的变体): 2000 → 二千 / 两千 */
function chineseForms(n: number): string[] {
  const cn = toChineseNumber(n);
  if (!cn) return [];
  const forms = [cn];
  if (/^二[百千万]/.test(cn)) forms.push(`两${cn.slice(1)}`);
  if (n === 2) forms.push('两');
  return forms;
}

/** src 里出现了完整的中文数字 form(前后都不是数字字符; "五"不能算进"五十"里) */
function containsWhole(src: string, form: string): boolean {
  let i = src.indexOf(form);
  while (i >= 0) {
    const before = src[i - 1] ?? '';
    const after = src[i + form.length] ?? '';
    if (!CN_NUM.includes(before) && !CN_NUM.includes(after)) return true;
    i = src.indexOf(form, i + 1);
  }
  return false;
}

/**
 * 画面文字(copy.ts 里的字符串)里的每个数字, 必须能在稿子或转写里找到:
 * 阿拉伯数字按数值比; 中文写法要完整出现(不许"五"蹭"五十"); 画面上的中文数字(三万)也查。
 */
export function checkNumbers(copyText: string, sources: string[]): string[] {
  const src = sources.join('\n').replace(/,/g, '');
  const srcNums = new Set(numberTokens(src));
  const texts = stringLiterals(copyText);
  const issues: string[] = [];
  for (const tok of new Set(texts.flatMap(numberTokens))) {
    if (srcNums.has(tok)) continue;
    if (chineseForms(Number(tok)).some((f) => containsWhole(src, f))) continue;
    issues.push(`画面数字 ${tok} 在稿子和转写里都找不到（可能是编造的）`);
  }
  const runs = new Set(texts.flatMap((t) => t.match(/[零一二两三四五六七八九十百千万]{2,}/g) ?? []).filter((r) => /[十百千万]/.test(r)));
  for (const run of runs) {
    const n = parseChineseNumber(run);
    if (n === null) continue;
    if (containsWhole(src, run) || srcNums.has(String(n)) || chineseForms(n).some((f) => containsWhole(src, f))) continue;
    issues.push(`画面数字 ${run} 在稿子和转写里都找不到（可能是编造的）`);
  }
  return issues;
}

/**
 * Film.tsx 的规矩: 画面文字只能来自 COPY; 镜头时间只能来自 shots.json(<Shot {...at.id}>);
 * shots.json 里的每个镜头都要在画面里用到。否则 check 查的和实际渲染的不是同一份东西。
 */
export function checkFilmSource(src: string, shots: ShotsFile): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const issues: string[] = [];
  for (const lit of stringLiterals(code)) {
    if (/[\u4e00-\u9fff]/.test(lit)) issues.push(`Film.tsx 里有画面文字，要写进 copy.ts：${lit}`);
  }
  const jsxText = /> *([^<>{}\n]+?) *</g;
  let m: RegExpExecArray | null;
  while ((m = jsxText.exec(code))) {
    const t = m[1].trim();
    if (/[\u4e00-\u9fff]/.test(t)) issues.push(`Film.tsx 里有画面文字，要写进 copy.ts：${t}`);
    else if (/^[\d.,%+/#×x-]+$/.test(t) && /\d/.test(t)) issues.push(`Film.tsx 里有画面数字，要写进 copy.ts：${t}`);
  }
  if (/<Shot\b[^>]*\b(from|to)=\{/.test(code)) issues.push('Shot 的时间要用 shots.json（写成 <Shot {...at.镜头id}>），不要手写秒数');
  if (!/\bat\[/.test(code)) {
    for (const s of shots.shots) {
      if (!new RegExp(`\\bat\\.${s.id}\\b`).test(code)) issues.push(`镜头 ${s.id} 在 Film.tsx 里没有用到`);
    }
  }
  return issues;
}

/** 版式: 不认识的值、横版 index.tsx 丢了 provider、与 --expect 不符, 都不通过 */
export function checkOrientation(data: { orientation?: unknown }, indexSrc: string, expect?: string | true): { orientation: FilmOrientation; issues: string[] } {
  const issues: string[] = [];
  const raw = data.orientation;
  if (raw !== undefined && !isFilmOrientation(raw)) issues.push(`data.json 里的版式不认识：${String(raw)}（只能是 portrait 或 landscape）`);
  const orientation: FilmOrientation = raw === 'landscape' ? 'landscape' : 'portrait';
  if (orientation === 'landscape' && !indexSrc.includes('<OrientationProvider value="landscape">')) {
    issues.push('横版片子的 index.tsx 被改动了（缺少 OrientationProvider）：不要改 index.tsx，用 film new --landscape 重建');
  }
  if (expect !== undefined) {
    if (!isFilmOrientation(expect)) issues.push('--expect 只能是 landscape 或 portrait');
    else if (expect !== orientation) issues.push(`要${orientationLabel(expect)}，但这个片子目录是${orientationLabel(orientation)}：用 film new${expect === 'landscape' ? ' --landscape' : ''} 重建`);
  }
  return { orientation, issues };
}
