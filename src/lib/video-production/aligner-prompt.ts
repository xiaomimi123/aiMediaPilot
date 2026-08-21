import { z } from 'zod';
import { ACT_KEYS, type ActKey, type ScriptAct } from '@/lib/script/six-act';
import type { ContentPart } from '@/lib/llm/vision';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export const AlignedActSchema = z.object({
  act: z.enum([...ACT_KEYS] as [ActKey, ...ActKey[]]),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});
export const AlignerResponseSchema = z.object({
  acts: z.array(AlignedActSchema).length(6), // 六幕固定顺序: hook/concept_a/concept_b/trivia/synthesis/punchline
});
export type AlignedAct = z.infer<typeof AlignedActSchema>;
export type AlignerResponse = z.infer<typeof AlignerResponseSchema>;

export const ALIGNER = {
  buildSystemPrompt(): string {
    return `你是一个"语音对齐器"。给你一段真实录音的逐句转写(带真实时间戳)，和一份六幕脚本的结构参照(每幕的主张/要点关键词)，你的任务是判断真实录音里每一句话对应六幕脚本的哪一幕，输出每一幕在真实录音里的起止时间(毫秒)。

重要前提: 说话人是照着要点自由发挥的，不是逐字念稿——录音原话和脚本文字大概率不一样，你要做的是语义匹配，不是文字匹配。

规则:
- 六幕顺序固定: hook(开场钩子) → concept_a(概念A) → concept_b(概念B) → trivia(冷知识) → synthesis(知识串联) → punchline(金句收尾)，说话人通常按这个顺序讲，但允许跳过某一幕。
- 六个时间区间首尾相接，覆盖录音从开始到结束的整个时长，不留空隙、不重叠。
- 如果说话人完全没讲到某一幕的内容，把该幕的 startMs 和 endMs 设成同一个值(零时长)，但仍要输出这一幕(六个都必须出现在结果里)。
- 允许合理误差，不追求逐词精确，只要求"大致讲到这个话题的时间段"。

只输出结构化 JSON，不要输出解释文字。`;
  },
  buildUserMessage(transcript: TranscriptSegment[], acts: ScriptAct[]): ContentPart[] {
    const transcriptText = transcript.map((s) => `[${(s.startSec * 1000).toFixed(0)}ms-${(s.endSec * 1000).toFixed(0)}ms] ${s.text}`).join('\n');
    const actsText = acts.map((a) => `${a.act}: 主张="${a.narration.slice(0, 40)}..." 关键词=${a.beats.map((b) => b.keyword).join('、')}`).join('\n');
    return [{
      type: 'text',
      text: `真实录音转写(真实时间戳+真实原话):\n${transcriptText}\n\n六幕脚本结构参照(仅供语义比对，不要求逐字匹配):\n${actsText}\n\n请输出六幕在这段录音里的真实起止时间。`,
    }];
  },
  responseSchema: AlignerResponseSchema,
};
