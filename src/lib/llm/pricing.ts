// 2026-06 OpenAI 公开定价 (USD per 1M tokens)。新定价时只改这张表。
const PRICING: Record<string, { promptPerMTok: number; completionPerMTok: number }> = {
  'gpt-4o':             { promptPerMTok: 2.5,  completionPerMTok: 10.0 },
  'gpt-4o-mini':        { promptPerMTok: 0.15, completionPerMTok: 0.6 },
  'whisper-1':          { promptPerMTok: 0,    completionPerMTok: 0 }, // Whisper 按秒计费,此处不用
  'deepseek-chat':      { promptPerMTok: 0.27, completionPerMTok: 1.10 },
  'deepseek-reasoner':  { promptPerMTok: 0.55, completionPerMTok: 2.19 },
};

export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (promptTokens * p.promptPerMTok + completionTokens * p.completionPerMTok) / 1_000_000;
}

/** Whisper 按音频秒计费, 当前 $0.006 / minute */
export function estimateWhisperCostUSD(audioSec: number): number {
  return (audioSec / 60) * 0.006;
}
