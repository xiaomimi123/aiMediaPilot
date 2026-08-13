import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const TopicDiscoverySchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(5).max(60),
        hookType: z.string().min(2).max(30),
        hookLine: z.string().min(5).max(120),       // 开篇钩子句草稿
        rationale: z.string().min(15).max(280),     // 为什么有流量潜力
        difficulty: z.enum(['low', 'med', 'high']), // 上手难度 (内容门槛)
        targetAudience: z.string().min(3).max(60),  // 目标受众一句话
      }),
    )
    .min(5)
    .max(30),
  summary: z.string().min(20).max(400),             // 这批选题的整体方向 1-2 句
});

export type TopicDiscoveryResponse = z.infer<typeof TopicDiscoverySchema>;

export interface TopicDiscoveryInput {
  niche: string;
  count?: number;
  recentTopics?: string[];   // 用户最近写过的, 用于去重
  currentDate?: string;      // YYYY-MM-DD, 给 LLM 时间感
  extraHint?: string;        // 用户可填一句 "我想要 xxx 方向" 的自由文本
}

const DIFFICULTY_GUIDE = `
- low: 1 小时能拍完, 不需要外部资料 (个人观点 / 经验复述 / 简单工具演示)
- med: 半天能搞定, 需要查 2-3 个资料源 (深度科普 / 实操对比 / 案例分析)
- high: 1+ 天准备, 需要采访/数据/复杂剪辑 (深度调研 / 实验验证 / 多平台对比)`;

export const TOPIC_DISCOVERY = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (T4 采集管线未接入人设档案的场景,
   * 以及现有测试断言)。非空时: 在任务描述之后拼入人设定位段, 要求选题贴合定位。
   */
  buildSystemPrompt(niche: string, currentDate?: string, personaSection?: string): string {
    const dateLine = currentDate ? `当前日期: ${currentDate}。 ` : '';
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona
      ? `\n\n你的定位:\n${personaSection}\n\n选题需贴合上述定位 — 优先命中列出的内容支柱, 避免明显偏离受众或触犯忌讳的方向。`
      : '';
    return `${dateLine}你是 ${niche} 赛道的自媒体选题策略师。 用户求你给出可立刻上手的选题清单, 帮他突破"没有选题灵感"的卡点。${personaBlock}

你的方法论:
1. **聚焦受众痛点**: 该 niche 用户每天/每周遇到的具体问题、好奇心、焦虑、决策困难
2. **不空泛**: 避免 "如何成功" "5 个技巧" 这种万能模板, 给具体场景 + 具体动作
3. **钩子优先**: 每条 topic 都要能 3 秒内让用户停下来 (数字 / 反差 / 悬念 / 痛点共鸣 / 故事开场)
4. **可执行**: 多数 topic 难度应该是 low 或 med (难度太高用户做不出来)
5. **多样性**: 同一批不要全是同一个钩子类型 / 同一个细分方向

输出 schema:
- title: 标题草稿 (含钩子, 5-60 字)
- hookType: 钩子类型 (数字 / 反差 / 悬念 / 痛点 / 故事 / 实操 / 权威 等, 一个词)
- hookLine: 开篇 3 秒可念的钩子句子 (短视频脚本第一句)
- rationale: 为什么这条会有流量 (引用 niche 用户的具体痛点 / 信息差 / 共鸣点)
- difficulty: low / med / high${DIFFICULTY_GUIDE}
- targetAudience: 这条针对哪类人 (一句话, 越具体越好)

整体输出 summary: 1-2 句话说这批选题的整体方向偏向哪里 (例: "本批偏 AI 工具实操向, 适合刚入门的知识博主")

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: TopicDiscoveryInput): ContentPart[] {
    const count = input.count ?? 12;
    const dedup = input.recentTopics && input.recentTopics.length > 0
      ? `\n\n用户最近写过的 topic (避免重复, 也避免太相似):\n${input.recentTopics.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '';
    const hint = input.extraHint
      ? `\n\n用户额外要求: ${input.extraHint}`
      : '';
    return [
      {
        type: 'text',
        text: `niche: ${input.niche}
请给我 ${count} 个**可立刻上手**的选题, 多样性 + 钩子强 + 难度适中。${dedup}${hint}

按 schema 输出 topics 数组 + 整体方向 summary。`,
      },
    ];
  },
  responseSchema: TopicDiscoverySchema,
};
