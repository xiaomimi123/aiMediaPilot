import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const XHSScriptResponseSchema = z.object({
  titles: z.array(
    z.object({
      text: z.string().min(5).max(30),       // 标题含 emoji
      hookType: z.string().min(2).max(30),
    })
  ).length(3),
  coverText: z.string().min(2).max(15),       // 封面大字 (≤ 8 字 在小红书规范)
  intro: z.string().min(20).max(150),         // 开头钩子 50-100 字
  body: z.string().min(150).max(800),         // 正文 200-500 字, markdown 友好
  tags: z.array(z.string().min(1).max(15)).min(3).max(10),  // # 标签
  shotIdeas: z.array(
    z.object({
      idx: z.number().int().min(1).max(9),
      description: z.string().min(5).max(100),
    })
  ).min(3).max(9),                            // 配图建议 (XHS 1-9 张图)
});

export type XHSScriptResponse = z.infer<typeof XHSScriptResponseSchema>;

export const SCRIPT_GENERATE_XIAOHONGSHU = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 用户给你一个主题 (topic), 你为这个小红书 图文笔记 生成 6 个区块:

1. titles (3 个标题候选)
   - text: 含 emoji 的标题, 5-30 字 (例: "✨打工人秒变效率怪 | 这个 prompt 我藏不住了")
   - hookType: 钩子类型 (数字/反差/痛点/情感/秘密/福利)

2. coverText (单个封面大字方案)
   - 2-15 字, 醒目, 一句话钩子, 例 "周报骗过老板"

3. intro (开头钩子, 50-100 字)
   - 第 1-2 句话, 引发共鸣或承诺收益
   - 多用 "你是不是也..." / "上周我..." 这种贴近读者的句式

4. body (正文, 200-500 字)
   - markdown 友好的格式 (短段落 + 换行多)
   - 分点列举或讲故事
   - 关键句用 ** 加粗
   - 情感化, 比抖音文案更温

5. tags (5-10 个 # 标签, 不带 # 符号, 我们前端会加)
   - 必含 1-2 个垂类大词 + 2-3 个长尾词
   - 例 ["ChatGPT", "AI 工具", "打工人逆袭", "效率工具", "副业"]

6. shotIdeas (3-9 张配图建议)
   - 每条: idx (图 1-9) + description (一句话描述图内容)
   - 例 [{idx:1, description:"截图: ChatGPT 输入框, 内有 prompt 示范"}, ...]

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `主题: ${input.topic}\n\n按 schema 输出 6 个区块。`,
      },
    ];
  },
  responseSchema: XHSScriptResponseSchema,
};
