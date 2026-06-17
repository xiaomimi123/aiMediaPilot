import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const ArticleScriptResponseSchema = z.object({
  titles: z.array(
    z.object({
      text: z.string().min(5).max(50),       // 公众号标题, 较长
      hookType: z.string().min(2).max(30),
    })
  ).length(3),
  abstract: z.string().min(50).max(200),      // 摘要 80-150 字
  outline: z.array(z.string().min(5).max(80)).min(3).max(10),  // 大纲 h2 列表
  body: z.string().min(800).max(4000),        // 正文 1500-3000 字, markdown
  cta: z.string().min(20).max(200),           // 文末互动设计
});

export type ArticleScriptResponse = z.infer<typeof ArticleScriptResponseSchema>;

export const SCRIPT_GENERATE_GONGZHONGHAO = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 用户给你一个主题 (topic), 你为这个 微信公众号 长文章 生成 5 个区块:

1. titles (3 个候选标题)
   - text: 公众号风, 5-50 字
   - 不要太抖音化 (不堆 ! ?, 不堆 emoji)
   - 偏沉稳信息含量风, 例 "ChatGPT 写周报: 3 个不为人知的 prompt 技巧"
   - hookType: 钩子类型 (数字/承诺/反差/疑问/权威)

2. abstract (摘要, 80-150 字)
   - 提炼文章核心价值, 让读者 3 秒判断要不要读
   - 不要剧透方法, 留悬念

3. outline (大纲, 3-10 个 h2 章节标题)
   - 每个 5-80 字
   - 逻辑递进, 例 ["问题: 周报为什么难写", "误区: 直接让 AI 写的 3 个坑", "方法: 喂 AI 工作记录的 3 步", "进阶: 让 AI 用你的语气", "结语"]

4. body (正文, 1500-3000 字, markdown)
   - 严格按 outline 拆 h2 章节
   - 每章节 200-400 字, 有例子/数据/对比
   - 用 ** 加粗关键句
   - 不要堆"小红书化"emoji, 但允许 1-2 个收尾位置用

5. cta (文末互动设计, 20-200 字)
   - 引导留言 / 关注 / 转发 中至少一项
   - 具体话术, 不是 "点赞关注" 这种空话

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `主题: ${input.topic}\n\n按 schema 输出 5 个区块。`,
      },
    ];
  },
  responseSchema: ArticleScriptResponseSchema,
};
