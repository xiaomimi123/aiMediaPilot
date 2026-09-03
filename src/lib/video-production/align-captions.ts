import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { numberToHanzi, type HanziSegment } from '@/lib/tts/number-to-hanzi';
import type { CaptionEvent } from './ass-captions';

/**
 * 字级对齐进管线(二十九期 Task 5)。
 *
 * 对齐是增强件不是依赖件——venv 缺失 / 脚本超时(120s) / 崩溃 / 输出解析失败
 * 都在这个模块内部吞掉、`console.warn` 一行, 对外返回一个"没有词级数据"的
 * 结果, 调用方(worker)据此原样退回逐句字幕, 不抛错、不挡出片。
 */

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'align', 'timestamps_cpu.py');
const DEFAULT_PYTHON_BIN = path.join(process.cwd(), 'scripts', 'align', '.venv', 'bin', 'python3');

/** 一个词(通常是一个汉字, 数字/百分比/区间/年份会合并成一个整体词)的时间戳。 */
export interface CaptionWord {
  word: string;
  startMs: number;
  endMs: number;
}

/** `timestamps_cpu.py` 输出的单个词条(秒, 与 CaptionWord 的毫秒不同单位)。 */
interface TimingWordRaw {
  text: string;
  start: number;
  end: number;
}

/** `timestamps_cpu.py` 输出的单句对齐结果。 */
interface TimingSentenceRaw {
  i: number;
  text: string;
  start: number;
  end: number;
  match: number;
  ok: boolean;
  words: TimingWordRaw[];
}

/** `timestamps_cpu.py` 的完整输出 schema (`{sr, total, sentences: [...]}`)。 */
export interface TimingPayload {
  sr: number;
  total: number;
  sentences: TimingSentenceRaw[];
}

/**
 * 校验 + 解析 timing.json 的原始文本。**不抛错**——格式不对就当没对齐成功,
 * 返回 null 交给调用方走降级路径, 这份数据本来就是"可有可无的增强件"。
 */
export function parseTimingPayload(raw: string): TimingPayload | null {
  try {
    const json = JSON.parse(raw);
    if (!json || !Array.isArray(json.sentences)) return null;
    for (const s of json.sentences) {
      if (typeof s.text !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') {
        return null;
      }
      if (!Array.isArray(s.words)) return null;
    }
    return json as TimingPayload;
  } catch {
    return null;
  }
}

// 与 timestamps_cpu.py 的 CJK/LATIN 正则同口径(见该文件 norm_char 附近注释)——
// 两边必须用同一套字符分类规则消费 words[], 否则这里按位置对应 words 会错位。
const CJK_RE = /[㐀-䶿一-鿿]/;
const LATIN_RE = /[A-Za-z0-9]/;

/**
 * 判断字符类别前先做 NFKC 归一化 —— 与 timestamps_cpu.py 的
 * `unicodedata.normalize("NFKC", ch)` 保持一致。
 *
 * 复审实测(2026-09-03): 缺这一步时, 全角字符(如 "３")在 JS 侧两个正则都不匹配、
 * 被当标点跳过且**不消费词条**, 而 python 侧把它归一成 "3" 当 LATIN 消费了一个 ——
 * 两侧游标从此错开, 该句后面**每个字都错拿前一个字的时间戳**, 静默的系统性一位
 * 错位。所以这里的归一化不是防御性代码, 是与 python 侧的**行为契约**。
 */
const normalizeChar = (ch: string): string => ch.normalize('NFKC');
const isLatin = (ch: string): boolean => LATIN_RE.test(normalizeChar(ch));
const isCjk = (ch: string): boolean => CJK_RE.test(normalizeChar(ch));

interface CharTime {
  startMs: number;
  endMs: number;
}

/**
 * 把 timestamps_cpu.py 吐出的 `words`(在参照文本里从左到右顺序出现,
 * 标点被跳过、CJK 逐字一词、拉丁/数字连续段合并一词)按顺序回填到参照文本
 * (`hanziText`)的每个字符位置上——这一步严格复刻 `timestamps_cpu.py`
 * `align()` 函数里 `for ci, ch in enumerate(text)` 那段回填逻辑(第 217-236
 * 行), 两边算法必须一致, 否则位置会对不上。
 *
 * 返回长度与 `hanziText` 相同的数组, 未参与对齐的字符(标点/空白)对应位置是
 * `null`。
 */
function mapWordsToHanziChars(hanziText: string, words: TimingWordRaw[]): Array<CharTime | null> {
  const result: Array<CharTime | null> = new Array(hanziText.length).fill(null);
  let wordCursor = 0;
  let i = 0;
  while (i < hanziText.length) {
    const ch = hanziText[i];
    if (isLatin(ch)) {
      // 拉丁/数字连续段在 python 侧被合并成一个 word——这里同样找出这一段
      // 的长度, 整段消费同一个 word 条目。
      let j = i;
      while (j < hanziText.length && isLatin(hanziText[j])) j += 1;
      const w = words[wordCursor];
      if (w) {
        const startMs = w.start * 1000;
        const endMs = w.end * 1000;
        for (let k = i; k < j; k += 1) result[k] = { startMs, endMs };
        wordCursor += 1;
      }
      i = j;
      continue;
    }
    if (isCjk(ch)) {
      const w = words[wordCursor];
      if (w) {
        result[i] = { startMs: w.start * 1000, endMs: w.end * 1000 };
        wordCursor += 1;
      }
      i += 1;
      continue;
    }
    // 标点/空白等: 不消费 word, 直接跳过。
    i += 1;
  }
  return result;
}

/**
 * 参照文本(hanzi)的逐字时间戳 + `numberToHanzi` 产出的 segments(原文↔参照文本
 * 逐段映射) → 挂在**原文**字位上的词级时间戳。
 *
 * 这是位置映射里最关键的一步(spec 点名"最难的一处")：
 * - 字面段(`original === hanzi`, 绝大多数普通汉字/标点): 原文与参照文本逐字
 *   一一对应, 直接按原文字符逐个取时间, 每个汉字各自成词。
 * - 数字转换段(`original !== hanzi`, 如 "1850%" → "百分之一千八百五十"):
 *   参照文本这一段可能比原文长得多, 逐字拆开挂回原文没有意义(原文那几个
 *   阿拉伯数字字符本来就不是一个个对应参照文本里的汉字)。这里把整段
 *   **合并成一个词**——`word` 用原文(屏幕上显示的"1850%"), 时间取这一段里
 *   全部参照字符时间戳的最早 start / 最晚 end。
 *
 * 找不到任何时间戳的字符(通常是这句话整体没对上、`words` 数量不够)会被
 * 跳过, 不产生词条——不伪造一个假时间比不产生更危险。
 */
export function mapSegmentsToWords(
  segments: HanziSegment[],
  charTimes: Array<CharTime | null>,
): CaptionWord[] {
  const words: CaptionWord[] = [];
  let cursor = 0;

  for (const seg of segments) {
    const segLen = seg.hanzi.length;
    if (seg.original === seg.hanzi) {
      // 字面段: 原文与参照文本逐字同位, 每个非空白字符各自成一个词。
      for (let k = 0; k < segLen; k += 1) {
        const t = charTimes[cursor + k];
        const ch = seg.original[k];
        if (t && ch.trim()) {
          words.push({ word: ch, startMs: t.startMs, endMs: t.endMs });
        }
      }
    } else {
      // 数字转换段: 合并成一个词, 取这段范围内时间戳的并集。
      let startMs: number | undefined;
      let endMs: number | undefined;
      for (let k = 0; k < segLen; k += 1) {
        const t = charTimes[cursor + k];
        if (!t) continue;
        if (startMs === undefined || t.startMs < startMs) startMs = t.startMs;
        if (endMs === undefined || t.endMs > endMs) endMs = t.endMs;
      }
      if (startMs !== undefined && endMs !== undefined) {
        words.push({ word: seg.original, startMs, endMs });
      }
    }
    cursor += segLen;
  }

  return words;
}

/** 单句质量关判定结果。 */
export interface AlignmentQuality {
  lowMatchCount: number;
  totalSentences: number;
}

/**
 * 结果封装: 每个 caption 事件(与 `sentenceCaptionEvents` 产出的顺序一一对应)
 * 各自的词级数据(对不上/降级时是 `undefined`), 以及整体质量统计。
 */
export interface AlignedCaptions {
  wordsPerEvent: Array<CaptionWord[] | undefined>;
  quality: AlignmentQuality;
}

/**
 * `CaptionEvent[]` + 对齐结果 → 每句的词级时间戳(挂回原文字位)。
 *
 * 纯函数, 不做 IO——`timing` 传 `null` 或句数对不上时整体退化: 全部
 * `undefined`(等价于没有对齐过, 调用方原样显示逐句字幕), 这比"凑一份
 * 对不上的词级数据"更安全, 因为词级数据一旦错位, 高亮会挂在错的字上,
 * 比完全没有高亮更容易误导用户。
 */
export function buildWordsForEvents(
  events: CaptionEvent[],
  timing: TimingPayload | null,
): AlignedCaptions {
  if (!timing || timing.sentences.length !== events.length) {
    if (timing) {
      console.warn(
        `[align-captions] timing.json 句数(${timing.sentences.length})与字幕句数(${events.length})不一致, 整体退回逐句字幕`,
      );
    }
    return { wordsPerEvent: events.map(() => undefined), quality: { lowMatchCount: 0, totalSentences: events.length } };
  }

  let lowMatchCount = 0;
  const wordsPerEvent: Array<CaptionWord[] | undefined> = events.map((event, i) => {
    const sentence = timing.sentences[i];
    if (!sentence.ok) lowMatchCount += 1;

    const { segments, hanzi } = numberToHanzi(event.text);
    // 参照文本必须与这句真正喂给对齐器的文本一致, 否则位置映射全错——
    // 这是内部一致性检查, 理论上不该触发(script.json 就是用同一份
    // numberToHanzi 结果拼出来的), 触发说明调用方传参出了问题, 安全起见
    // 仍然只降级不抛错。
    if (sentence.text !== hanzi) {
      console.warn(`[align-captions] 第 ${i} 句参照文本与 timing.json 不一致, 该句退回逐句字幕`);
      return undefined;
    }

    const charTimes = mapWordsToHanziChars(hanzi, sentence.words);
    const words = mapSegmentsToWords(segments, charTimes);
    return words.length > 0 ? words : undefined;
  });

  return { wordsPerEvent, quality: { lowMatchCount, totalSentences: events.length } };
}

/**
 * 真正调用 `timestamps_cpu.py` 子进程做字级对齐。
 *
 * - 参照文本: 每句 `numberToHanzi(event.text).hanzi`, 按 events 顺序拼成
 *   `script.json` 喂给对齐器——这个顺序必须与 TTS 音频拼接顺序一致(两边都是
 *   "按 acts 数组顺序, 幕内按 splitSentences 顺序"), 否则整条时间轴错位。
 * - 输出: timing.json 落 `productionRoot`(spec 要求可查可复用, 不用临时目录)。
 * - 失败路径全部返回 `null` + `console.warn`, 由调用方决定如何降级——本函数
 *   本身不知道"降级"具体长什么样(那是 `buildWordsForEvents` 的事)。
 */
export async function runCaptionAlignment(opts: {
  audioPath: string;
  events: CaptionEvent[];
  productionRoot: string;
  pythonBin?: string;
  scriptPath?: string;
  timeoutMs?: number;
}): Promise<TimingPayload | null> {
  const pythonBin = opts.pythonBin ?? DEFAULT_PYTHON_BIN;
  const scriptPath = opts.scriptPath ?? DEFAULT_SCRIPT_PATH;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const timingPath = path.join(opts.productionRoot, 'timing.json');
  const scriptJsonPath = path.join(os.tmpdir(), `align-script-${path.basename(opts.productionRoot)}-${Date.now()}.json`);

  try {
    await fs.access(pythonBin);
  } catch {
    console.warn(`[align-captions] 找不到对齐 venv(${pythonBin}), 跳过字级对齐, 退回逐句字幕。先跑 scripts/align/setup-venv.sh`);
    return null;
  }

  const sentences = opts.events.map((e) => numberToHanzi(e.text).hanzi);

  try {
    await fs.writeFile(scriptJsonPath, JSON.stringify({ sentences }), 'utf-8');
    await execFileAsync(pythonBin, [scriptPath, opts.audioPath, scriptJsonPath, timingPath, '--backend', 'whisper'], {
      timeout: timeoutMs,
      maxBuffer: 1 << 24,
    });
    const raw = await fs.readFile(timingPath, 'utf-8');
    const parsed = parseTimingPayload(raw);
    if (!parsed) {
      console.warn('[align-captions] timing.json 格式不符合预期, 退回逐句字幕');
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[align-captions] 字级对齐失败(超时/崩溃), 退回逐句字幕: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await fs.unlink(scriptJsonPath).catch(() => {});
  }
}
