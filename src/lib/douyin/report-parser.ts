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

function requireBigInt(md: string, regex: RegExp, fieldName: string): bigint {
  const m = regex.exec(md);
  if (!m) throw new Error(`report.md 缺少必填字段: ${fieldName}`);
  return BigInt(m[1].replace(/,/g, ''));
}

/** 百分比 (12.34%) → BasisPoints * 100 (1234) */
function extractBp(md: string, regex: RegExp): number | null {
  const m = regex.exec(md);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

function computeRateBp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  // BigInt 除法保留精度: numerator × 1e6 / denominator → Number
  const ratio = Number((numerator * 1000000n) / denominator);
  return Math.round(ratio / 100);
}

function extractTopComments(md: string): { text: string; likes: number }[] | null {
  const section = md.match(/##\s*Top \d+ 评论\s*([\s\S]*?)(?=\n##\s|\n*$)/);
  if (!section) return null;
  const items: { text: string; likes: number }[] = [];
  const lineRegex = /^-\s*\((\d+)\s*赞\)\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(section[1])) !== null) {
    items.push({ likes: parseInt(m[1], 10), text: m[2].trim() });
  }
  return items.length > 0 ? items : null;
}

export async function parseReportMd(filePath: string): Promise<ActualMetricInput> {
  const md = await fs.readFile(filePath, 'utf-8');

  const plays = requireBigInt(md, /播放[:\s]+([\d,]+)/, '播放');
  const likes = requireBigInt(md, /点赞[:\s]+([\d,]+)/, '点赞');
  const comments = requireBigInt(md, /评论[:\s]+([\d,]+)/, '评论');
  const shares = requireBigInt(md, /转发[:\s]+([\d,]+)/, '转发');
  const collects = requireBigInt(md, /收藏[:\s]+([\d,]+)/, '收藏');

  return {
    plays,
    likes,
    comments,
    shares,
    collects,
    completionRateBp: extractBp(md, /完播率[:\s]+([\d.]+)%/),
    retention3sBp: extractBp(md, /3s\s*留存[:\s]+([\d.]+)%/),
    followConversionBp: extractBp(md, /转粉率[:\s]+([\d.]+)%/),
    likeRateBp: computeRateBp(likes, plays),
    commentRateBp: computeRateBp(comments, plays),
    shareRateBp: computeRateBp(shares, plays),
    topComments: extractTopComments(md),
  };
}
