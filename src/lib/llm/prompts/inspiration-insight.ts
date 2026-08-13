import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const InspirationInsightSchema = z.object({
  titlePatterns: z.array(z.string().min(3).max(200)).min(1).max(5),       // 标题模式总结
  hookTypes: z.array(z.string().min(2).max(30)).min(1).max(8),            // 钩子类型分布
  durationInsight: z.string().min(10).max(300),                            // 时长规律 一句话
  topicClusters: z.array(z.string().min(3).max(80)).min(1).max(6),        // topic 聚类
  recommendedTopics: z.array(
    z.object({
      title: z.string().min(5).max(60),
      rationale: z.string().min(10).max(200),
    })
  ).min(3).max(7),                                                          // 给你 3-7 个 next topic 建议
  summary: z.string().min(50).max(500),                                    // 整体一段话总结
});

export type InspirationInsightResponse = z.infer<typeof InspirationInsightSchema>;

export type InsightPlatform = 'douyin' | 'xiaohongshu' | 'gongzhonghao' | 'mixed';

export interface InsightInput {
  videos: {
    title: string;
    authorName?: string | null;
    playCount?: number | null;
    likeCount?: number | null;
    commentCount?: number | null;
    duration?: number | null; // seconds
    userNote?: string | null;
  }[];
  niche?: string;
  platform?: InsightPlatform;
}

const PLATFORM_CONTEXT: Record<InsightPlatform, string> = {
  douyin: '抖音 (短视频, 钩子前 3 秒决定完播)',
  xiaohongshu: '小红书 (图文笔记 + 短标题, emoji 常见, 双栏阅读)',
  gongzhonghao: '微信公众号 (长文章, 标题为单一抓人点)',
  mixed: '多平台混合 — 抽提通用规律即可',
};

export const INSPIRATION_INSIGHT = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (T4 采集管线未接入人设档案的场景,
   * 以及现有测试断言)。非空时: 在任务描述之后拼入人设定位段, 要求 recommendedTopics 贴合定位。
   */
  buildSystemPrompt(niche?: string, platform?: InsightPlatform, personaSection?: string): string {
    const nicheLine = niche ? `用户的内容垂类: ${niche}。 ` : '';
    const platformLine = platform
      ? `分析对象: ${PLATFORM_CONTEXT[platform]}。 `
      : '分析对象: 抖音短视频。 ';
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona
      ? `\n\n你的定位:\n${personaSection}\n\n推荐的下一步 topic (recommendedTopics) 应贴合上述定位 — 优先命中列出的内容支柱。`
      : '';
    return `${nicheLine}${platformLine}你是内容策略分析师。 用户提供 N 条他们精选的爆款 (标题/作者/播放/点赞/评论/时长), 你的任务是抽取共性规律 + 推出可执行的下一步 topic。${personaBlock}

输出结构 (按 schema 严格输出):

1. titlePatterns (1-5 条): 标题写法的共性, 每条具体可学。 例: "都以数字开头 (60% 含 '3个'/'5种')", "都用反差词 ('竟然' '想不到')", "平均字数 18-25 字"

2. hookTypes (1-8 个): 检测到的钩子类型分布。 例: ["数字", "反差", "悬念", "情绪"]

3. durationInsight: 时长规律, 一句话。 例: "高赞集中在 45-60 秒, 短于 30 秒的明显流量低 30%"

4. topicClusters (1-6 个): 主题聚类。 例: ["AI 工具实操", "效率提升", "副业变现"]

5. recommendedTopics (3-7 个): 基于以上分析推荐你下一步可拍的 topic。 每条:
   - title: 标题草稿 (含钩子)
   - rationale: 为什么这个 topic 有流量潜力 (基于上面共性)

6. summary: 整体 1 段话总结 (50-500 字), 告诉用户 "这批视频教会你什么"

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: InsightInput): ContentPart[] {
    const lines = input.videos.map((v, i) => {
      const stats = [
        v.playCount != null ? `播放${v.playCount}` : null,
        v.likeCount != null ? `赞${v.likeCount}` : null,
        v.commentCount != null ? `评${v.commentCount}` : null,
        v.duration != null ? `${v.duration}s` : null,
      ]
        .filter(Boolean)
        .join(' / ');
      const author = v.authorName ? `@${v.authorName}` : '';
      const note = v.userNote ? `\n   笔记: ${v.userNote}` : '';
      return `${i + 1}. ${author} ${v.title}\n   ${stats}${note}`;
    });
    const platformHint =
      input.platform && input.platform !== 'mixed' ? ` (${PLATFORM_CONTEXT[input.platform]})` : '';
    return [
      {
        type: 'text',
        text: `以下 ${input.videos.length} 条精选爆款${platformHint}:\n\n${lines.join('\n\n')}\n\n按 schema 输出共性分析 + 下一步推荐 topic。`,
      },
    ];
  },
  responseSchema: InspirationInsightSchema,
};
