import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';

export const PublishKitSchema = z.object({
  titles: z.array(z.string().min(1)).length(3),
  hashtags: z.array(z.string().min(1)).min(1).max(8),
  coverText: z.array(z.string().min(1)).min(1).max(2),
});
export type PublishKit = z.infer<typeof PublishKitSchema>;

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，为一条已经做好的口播视频写发布文案。
- titles：3 个候选标题（发布时的文案开头），口语、具体，不标题党、不编数字。
- hashtags：话题标签，每个以 # 开头，3～6 个，贴合内容和账号定位。
- coverText：封面上的大字，1～2 行，每行不超过 12 字。
只用稿子里有的事实；没出处的数字不写。只输出 JSON。`;

export async function generatePublishKit(llm: StructuredLLM, input: { scriptText: string; personaText: string; benchmarkTitlePattern?: string }): Promise<PublishKit> {
  const { result } = await llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      {
        type: 'text',
        text: `【账号定位】\n${input.personaText || '（未填写）'}\n\n【定稿】\n${input.scriptText}${input.benchmarkTitlePattern ? `\n\n【参考的对标标题写法】（借结构，不照抄）\n${input.benchmarkTitlePattern}` : ''}`,
      },
    ],
    responseSchema: PublishKitSchema,
  });
  return result;
}
