/**
 * 数字 → 汉字读法(二十九期 Task 5)。
 *
 * 为什么需要它: 字级对齐(`scripts/align/timestamps_cpu.py`)按文本逐字锚定 ASR
 * 转写出的语音——"1850"这四个阿拉伯数字字符对不上配音里实际念出来的"一千八百
 * 五十"这四个汉字的读音, 直接拿显示文本喂给对齐器, 数字附近的锚点会大面积流失
 * (spec §3.5)。这里只把喂给对齐器的**参照文本**里的数字转成汉字读法——不改
 * 落库的稿子, 也不改字幕显示文本(屏幕上仍然显示"1850%", 只是对齐器背后拿
 * "百分之一千八百五十"这份参照文本去匹配语音)。
 *
 * 返回 segments 而不是单纯返回转换后的字符串: 调用方(`align-captions.ts`)
 * 需要把对齐器吐出的、按参照文本(hanzi)字位算出的时间戳, 映射回原文
 * (original)的字位上, 才能往 `CaptionItem.words` 里塞"这段原文对应这段时间"
 * 的词条。segments 保留了 original/hanzi 的逐段对应关系, 这份映射就不用
 * 另外发明一套算法 —— 拼接 segments[].original 等于原文, 拼接
 * segments[].hanzi 等于参照文本, 一一对应。
 */

export interface HanziSegment {
  /** 原文里的这一段, 可能是数字串(含单位符号)也可能是普通文字/标点。 */
  original: string;
  /** 供对齐器使用的参照读法; 非数字片段与 original 完全相同。 */
  hanzi: string;
}

export interface NumberToHanziResult {
  /** 拼接 segments[].original 与传入的 text 完全相等。 */
  segments: HanziSegment[];
  /** 拼接 segments[].hanzi 得到的参照文本, 喂给对齐器用。 */
  hanzi: string;
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_UNITS_4 = ['', '十', '百', '千'];
// 与个/十/百/千同级往上数的"节"单位——每 4 位一节, 节内部按 CN_UNITS_4 读。
const CN_SECTION_UNITS = ['', '万', '亿', '万亿'];

/** 阿拉伯数字单个字符 → 汉字数字, 逐位替换, 不做进位读法(年份/编号读法用)。 */
function digitByDigit(digits: string): string {
  return digits
    .split('')
    .map((d) => CN_DIGITS[Number(d)])
    .join('');
}

/** 1~4 位数字串(无前导零参与进位判断) → 汉字, "个/十/百/千"这一节内的读法。 */
function convertSection(digits: string): string {
  const n = digits.length;
  let out = '';
  for (let i = 0; i < n; i += 1) {
    const d = Number(digits[i]);
    const unit = CN_UNITS_4[n - 1 - i];
    if (d === 0) {
      // 只有当前面已经吐过字符、且后面还有非零数字时才补一个"零"占位,
      // 避免"1005"漏读中间的零, 也避免尾部连续零(如"1500"里的最后两个 0)
      // 各补一个零。
      const restHasNonZero = digits
        .slice(i + 1)
        .split('')
        .some((c) => c !== '0');
      if (out && !out.endsWith('零') && restHasNonZero) out += '零';
    } else {
      out += CN_DIGITS[d] + unit;
    }
  }
  return out;
}

/** 任意长度整数字符串(纯数字, 无符号) → 中文读法。 */
export function integerToHanzi(numStr: string): string {
  const stripped = numStr.replace(/^0+(?=\d)/, '');
  if (stripped === '' || stripped === '0') return '零';

  // 按 4 位一节, 从个位往高位分节(与 CN_SECTION_UNITS 的下标对应)。
  const sections: string[] = [];
  let rest = stripped;
  while (rest.length > 0) {
    sections.unshift(rest.slice(-4));
    rest = rest.slice(0, -4);
  }

  const parts: string[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const raw = sections[i];
    const sectionUnit = CN_SECTION_UNITS[sections.length - 1 - i];
    if (Number(raw) === 0) continue; // 整节全零, 这一节(及其单位)整体跳过

    let sectionText = convertSection(raw.replace(/^0+(?=\d)/, '') || '0');
    // 这一节有前导零(比如 1_0500 里的 "0500"节), 且前面已经吐过更高位的
    // 节, 需要在两节之间补一个"零"占位——不然"一万零五百"会被读成"一万五百"。
    if (raw.length === 4 && raw[0] === '0' && parts.length > 0) {
      sectionText = `零${sectionText}`;
    }
    parts.push(sectionText + sectionUnit);
  }

  let result = parts.join('');
  // "十X"这一档(10~19)按习惯不读前面那个"一", "十四"而不是"一十四"。
  if (result.startsWith('一十')) result = result.slice(1);
  return result;
}

/** "整数" 或 "整数.小数" 字符串 → 中文读法; 小数部分逐位读。 */
function numberReading(numStr: string): string {
  const dot = numStr.indexOf('.');
  if (dot === -1) return integerToHanzi(numStr);
  const intPart = numStr.slice(0, dot);
  const decPart = numStr.slice(dot + 1);
  const intReading = intPart === '' ? '零' : integerToHanzi(intPart);
  return `${intReading}点${digitByDigit(decPart)}`;
}

/**
 * 数字模式, 按优先级从高到低排列(靠谁在同一起始位置先被 JS regex 引擎
 * 命中来生效——年份/百分比/区间比普通整数更"具体", 必须排在前面):
 *
 * - 年份: 4 位数字紧跟"年"字, 按编号读法逐位念(与真实口语一致:
 *   "1850年"念"一八五零年", 不是"一千八百五十年")。
 * - 百分比: 数字(含小数)紧跟"%", 读作"百分之 X"。
 * - 区间: 两个数字用短横线连接, 读作"X 到 Y"。
 * - 普通数字(整数/小数): 按进位读法。
 */
const NUMBER_PATTERN = /(\d{4})年|(\d+(?:\.\d+)?)%|(\d+)-(\d+)|(\d+(?:\.\d+)?)/g;

export function numberToHanzi(text: string): NumberToHanziResult {
  const segments: HanziSegment[] = [];
  let lastIndex = 0;
  NUMBER_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign -- 标准的 regex.exec 循环写法
  while ((match = NUMBER_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      const literal = text.slice(lastIndex, match.index);
      segments.push({ original: literal, hanzi: literal });
    }

    const [full, year, percent, rangeLeft, rangeRight, plain] = match;
    let hanzi: string;
    if (year !== undefined) {
      hanzi = `${digitByDigit(year)}年`;
    } else if (percent !== undefined) {
      hanzi = `百分之${numberReading(percent)}`;
    } else if (rangeLeft !== undefined && rangeRight !== undefined) {
      hanzi = `${numberReading(rangeLeft)}到${numberReading(rangeRight)}`;
    } else {
      hanzi = numberReading(plain);
    }
    segments.push({ original: full, hanzi });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    const literal = text.slice(lastIndex);
    segments.push({ original: literal, hanzi: literal });
  }

  return { segments, hanzi: segments.map((s) => s.hanzi).join('') };
}
