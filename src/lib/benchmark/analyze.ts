import path from 'node:path';
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import type { TranscriptLine } from '@/lib/recording/transcript';
import { proofreadAgainst } from '@/lib/recording/proofread';
import { EgoUnavailableError } from '@/lib/ego';
import { DouyinLoginError, DouyinRejectedError } from './parse';
import type { DouyinClient } from './douyin';
import type { BenchmarkStore } from './store';

export const AnalysisSchema = z.object({
  topic: z.string().min(1),
  hook: z.object({ quote: z.string().min(1), type: z.string().min(1) }),
  titlePattern: z.string().min(1),
  fit: z.enum(['high', 'mid', 'low']),
  fitReason: z.string().min(1),
  myAngle: z.string().min(1),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export interface AnalyzeDeps {
  store: BenchmarkStore;
  client: Pick<DouyinClient, 'downloadVideo'>;
  transcribe(videoPath: string): Promise<TranscriptLine[]>;
  llm: StructuredLLM | null;
  personaText: string;
  tmpDir: string;
  removeFile(p: string): Promise<void>;
}

class StepError extends Error {}

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，负责拆解一条对标爆款，帮博主判断能借什么。
只借三样：选题、开头钩子的写法、标题/文案写法。不评价画面，不复述全文。
- topic：一句话说清这条讲什么（不超过 30 字）。
- hook.quote：视频前 3 秒的原话（从逐字稿开头摘，不改字）；hook.type：钩子写法类型，如 反常识 / 提问 / 数字冲击 / 冲突对比 / 身份代入 / 悬念。
- titlePattern：它的标题和文案是怎么写的（结构，不照抄）。
- fit：这个选题和博主定位的契合度 high / mid / low；fitReason：对上了定位里哪个内容支柱或痛点，或为什么不合适（踩了忌讳也要说）。
- myAngle：博主可以怎么讲这个选题（一两句）。不得替博主编造经历、测试结果或数据。
只输出 JSON。`;

export function explainAnalyzeError(e: unknown): string {
  if (e instanceof EgoUnavailableError) return '下载视频时 ego lite 没有响应：打开 ego lite 重新登录一次，再点重试。';
  if (e instanceof DouyinLoginError) return e.message;
  if (e instanceof DouyinRejectedError) return `抖音没有给视频（${e.message}）。可能作品已删除或设为私密；稍后点重试。`;
  if (e instanceof StepError) return e.message;
  return '拆解中途出错了，点重试再来一次。';
}

export async function analyzeVideo(deps: AnalyzeDeps, videoId: string): Promise<boolean> {
  const v = await deps.store.getVideo(videoId);
  if (!v) return false;
  await deps.store.updateVideo(videoId, { analysisStatus: 'running', analysisError: null, analysisStartedAt: new Date() });
  // 每次拆解用不重名的临时文件: 巡检脚本和网页可能同时拆同一条
  const file = path.join(deps.tmpDir, `bm-${v.awemeId}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  try {
    if (!deps.llm) throw new StepError('还没有可用的模型：去设置页添加一个，然后点重试。');
    await deps.client.downloadVideo(v.awemeId, file);
    let lines: TranscriptLine[];
    try {
      lines = await deps.transcribe(file);
    } catch (e) {
      throw new StepError('转写失败：本地转写没跑起来，去设置页看「本地转写」体检项，修好后点重试。', { cause: e });
    }
    if (lines.length === 0) throw new StepError('转写结果是空的：这条视频可能没有人声。');
    const proof = await proofreadAgainst(deps.llm, { label: '视频文案', text: v.desc }, lines);
    const transcript = proof.lines.map((l) => l.text).join('\n');
    let analysis: Analysis;
    try {
      const { result } = await deps.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [{ type: 'text', text: `【博主定位】\n${deps.personaText || '（未填写）'}\n\n【对标视频文案】\n${v.desc}\n\n【逐字稿】\n${transcript}` }],
        responseSchema: AnalysisSchema,
      });
      analysis = result;
    } catch (e) {
      throw new StepError('模型这次没按格式交回拆解，点重试再来一次。', { cause: e });
    }
    await deps.store.updateVideo(videoId, { analysisStatus: 'done', analysisError: null, transcript, analysis, analyzedAt: new Date() });
    return true;
  } catch (e) {
    await deps.store.updateVideo(videoId, { analysisStatus: 'failed', analysisError: explainAnalyzeError(e) });
    return false;
  } finally {
    await deps.removeFile(file).catch(() => {});
  }
}
