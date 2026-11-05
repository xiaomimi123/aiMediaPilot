import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { CHARS_PER_SEC } from '@/lib/script/duration';
import { findFlavorInText, type FlavorHit } from '@/lib/script/flavor-check';

/**
 * 草稿扩写: 用户在写稿台写了一半(或只有一句灵感), AI 按已有内容往下长,
 * 规矩与 write.ts 一致 —— 不编造, 用户没提供的经历/数字写【待补】。
 */

export const ExpandOutSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  questions: z.array(z.string()),
});
export type ExpandOut = z.infer<typeof ExpandOutSchema>;

const SYSTEM_PROMPT = `你是抖音 AI 知识类口播博主的编导，帮博主把写了一半的草稿往下长成完整口播稿。
规矩：
- 只在已有内容的基础上往下写：顺着他的思路和结构补齐，不大改他已经写的句子（错字可顺手改）。
- 写得像博主本人在说话，不像文章。句子长短不齐，允许口语和语气词。
- 用具体的东西（具体的工具、具体的人、具体的场景），不说「一个工具」「很多用户」。
- 不编造数字和事实；没有出处的数字直接不写。
- 不写用户没提供的第一人称经历、试用结果、小故事。需要亲身例子时写「【待补：…】」，写清要补什么。
- 句子里不许有 AI 腔：不写「不是…而是…」句式；不写犹豫词（说实话、我觉得可能、好像有点）；不写套话垫场（众所周知、总而言之、换句话说）；不写空泛金句和书面热词（赋能、抓手、闭环、底层逻辑、认知升级、改变我们的生活方式）。
- 结构按口播节拍走：钩子 → 我是谁·当时 → 遇到什么 → 怎么做的 → 结果 → 经验或悬念。已有内容放在最贴合的节拍里。
- 结尾给 questions：3 条以内，问博主只有他自己知道、补上稿子会明显变好的事（比如真实经历、具体数字）。
- 只输出 JSON：{"title": "视频标题", "text": "完整口播稿", "questions": ["…"]}。`;

export function expandMessage(o: { body: string; ideaText?: string | null; targetSec: number }): string {
  const parts: string[] = [];
  if (o.ideaText && o.ideaText.trim() && o.ideaText.trim() !== o.body.trim()) {
    parts.push(`【最初记下的灵感】\n${o.ideaText.trim()}`);
  }
  parts.push(`【草稿】（写了一半的口播稿，在它基础上往下长）\n${o.body.trim()}`);
  parts.push(`【目标时长】${o.targetSec} 秒，按口语 ${CHARS_PER_SEC} 字/秒，约 ${o.targetSec * CHARS_PER_SEC} 字`);
  parts.push('把它长成一篇完整的口播逐字稿。');
  return parts.join('\n\n');
}

export async function expandDraft(opts: { llm: StructuredLLM; body: string; ideaText?: string | null; targetSec: number }): Promise<ExpandOut & { flavor: FlavorHit[] }> {
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [{ type: 'text', text: expandMessage(opts) }],
    responseSchema: ExpandOutSchema,
  });
  if (!result.text.trim()) throw new Error('模型返回了空稿子，再说一次试试。');
  return { ...result, flavor: findFlavorInText(result.text) };
}
