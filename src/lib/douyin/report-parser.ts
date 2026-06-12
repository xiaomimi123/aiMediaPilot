import { promises as fs } from 'fs';

export interface ActualMetricInput {
  plays: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  collects: bigint;
  completionRateBp: number | null;
  retention3sBp: number | null;
  followConversionBp: number | null;
  likeRateBp: number | null;
  commentRateBp: number | null;
  shareRateBp: number | null;
  topComments: { text: string; likes: number }[] | null;
}

/**
 * 解析 cheat-on-content `_fmt_num` 的输出:
 *   "2.5w" → 25000n
 *   "1.2亿" → 120000000n  (renderer 当前只出 w, 但留兜底)
 *   "500"  → 500n
 *   "12,345" → 12345n  (英文千位分隔, 兜底)
 *   "-" / "" → null
 */
function parseChineseNum(raw: string): bigint | null {
  const s = raw.trim();
  if (s === '-' || s === '') return null;
  const m = s.match(/^([\d,]+(?:\.\d+)?)\s*(w|万|亿)?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  let result: number;
  if (m[2] === '亿') result = n * 100_000_000;
  else if (m[2] === 'w' || m[2] === '万') result = n * 10_000;
  else result = n;
  return BigInt(Math.round(result));
}

/** 必填字段: 不在 → throw; 解析失败 ("-" / 格式错) → throw。 */
function requireCount(md: string, label: string): bigint {
  // 半角 : 或全角 ：
  const re = new RegExp(`${label}[:：]\\s*([^\\n]+)`);
  const m = re.exec(md);
  if (!m) throw new Error(`report.md 缺少必填字段: ${label}`);
  const parsed = parseChineseNum(m[1]);
  if (parsed === null) throw new Error(`report.md 字段 "${label}" 值无效: ${m[1].trim()}`);
  return parsed;
}

/**
 * 可选百分比字段: 不在 → null; "12.34%" → 1234。
 * 注: cheat-on-content 当前 renderer 不输出完播率等到 markdown 平文,
 *     只在可选 `### 详细指标` JSON 块,所以大多数情况返回 null。
 */
function extractBp(md: string, label: string): number | null {
  const re = new RegExp(`${label}[:：]\\s*([\\d.]+)\\s*%`);
  const m = re.exec(md);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

function computeRateBp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  // numerator × 1e6 / denominator → Number(保留 6 位精度) → / 100 → BasisPoints*100
  const ratio = Number((numerator * 1000000n) / denominator);
  return Math.round(ratio / 100);
}

/**
 * 评论 section. cheat-on-content 实际输出格式:
 *   ## 评论（按点赞降序，共 N 条）
 *
 *   - [👍12] 评论文本
 *   - [👍0 💬1] 含回复的评论
 */
function extractTopComments(md: string): { text: string; likes: number }[] | null {
  // 评论 section header (中文/英文括号均匹配)
  const section = md.match(/##\s*评论[（(][^)）]*[)）]\s*([\s\S]*?)(?=\n##\s|\n*$)/);
  if (!section) return null;
  const items: { text: string; likes: number }[] = [];
  // 行: - [👍N] text  OR  - [👍N 💬M] text
  const lineRegex = /^-\s*\[👍(\d+)(?:\s*💬\d+)?\]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(section[1])) !== null) {
    items.push({ likes: parseInt(m[1], 10), text: m[2].trim() });
  }
  return items.length > 0 ? items : null;
}

export async function parseReportMd(filePath: string): Promise<ActualMetricInput> {
  const md = await fs.readFile(filePath, 'utf-8');

  // 真实 cheat-on-content renderer.py 用 「分享」 不是 「转发」
  const plays = requireCount(md, '播放');
  const likes = requireCount(md, '点赞');
  const comments = requireCount(md, '评论');
  const shares = requireCount(md, '分享');
  const collects = requireCount(md, '收藏');

  return {
    plays,
    likes,
    comments,
    shares,
    collects,
    // 留存指标: 当前 renderer 不输出为 markdown 字段。 regex 保留兼容未来扩展 / 其他 adapter。
    completionRateBp: extractBp(md, '完播率'),
    retention3sBp: extractBp(md, '3s\\s*留存'),
    followConversionBp: extractBp(md, '转粉率'),
    likeRateBp: computeRateBp(likes, plays),
    commentRateBp: computeRateBp(comments, plays),
    shareRateBp: computeRateBp(shares, plays),
    topComments: extractTopComments(md),
  };
}
