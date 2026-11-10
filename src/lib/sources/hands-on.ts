import type { StructuredLLM } from '@/lib/script/write';
import { z } from 'zod';

/**
 * 亲测档升级: 从快讯条目(GitHub 仓库)生成亲测档选题材料——
 * 点子池条目(带方向和钩子) + 按项目的实测问题清单。
 * 用户边装边答问题, 答完走 rewriteWithAnswers 按他的话写 90 秒稿(出镜口播链)。
 * roadmap 定位: 快讯档反响好的再升级成亲测档; 讲「装到哪卡住、能不能用、适合谁」。
 */

const HandsOnPlanSchema = z.object({
  title: z.string().min(1).max(60),
  direction: z.string().min(10).max(600),
  hook: z.string().min(1).max(120),
  questions: z.array(z.string().min(4).max(120)).min(3).max(6),
});
export type HandsOnPlan = z.infer<typeof HandsOnPlanSchema>;

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导。博主要把一个开源项目升级成「亲测档」视频(60~90 秒, 出镜口播, 只讲真试过的), 现在还没开始装, 你负责出实测问题清单让他边装边答。
- title: 视频标题方向(现在定不了结论, 写「我试了 XX」这类体验视角, 不写假结论)。
- direction: 这条讲什么(安装流程会经过哪些坎、哪里容易翻车、普通人上手要准备什么), 只依据 README。
- hook: 开头钩子的方向(体验视角, 如「这个项目据说很神, 我装了一天, 结果…」)。
- questions(3~6 个): 博主亲手装/试时才能回答的问题, 边装边答几句话就够。要覆盖: 装的时候哪一步卡住/最费劲、实际跑起来的真实效果(跟 README 宣传比差在哪)、过程中印象最深的一个细节、最适合什么样的人/不适合什么人、如果值得讲一句最想吐槽或最惊艳的点。问题要具体到这个项目, 不问泛泛的「感觉怎么样」。
只输出 JSON。`;

export async function designHandsOn(opts: { llm: StructuredLLM; repo: string; starCount: number | null; readme: string }): Promise<HandsOnPlan> {
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      { type: 'text', text: `【仓库】${opts.repo}${opts.starCount !== null ? `（GitHub ${opts.starCount.toLocaleString('en-US')} stars）` : ''}\n【README 摘录】\n${opts.readme.slice(0, 3000)}\n出这个项目的实测问题清单。` },
    ],
    responseSchema: HandsOnPlanSchema,
  });
  return result;
}

/** 升级后的点子池条目文本(进 TopicIdea, 走「按我的话写」问答链) */
export function handsOnIdeaText(plan: HandsOnPlan, repo: string, starCount: number | null): string {
  const stars = starCount !== null ? `（GitHub ${starCount.toLocaleString('en-US')} stars）` : '';
  return `【亲测档·${repo}${stars}】\n标题方向：${plan.title}\n讲什么：${plan.direction}\n钩子方向：${plan.hook}\n（这是快讯档升级的亲测档选题，等我亲手装完答完实测问题再按我的话写 90 秒稿。）`;
}

/** 亲测档目标时长(秒): roadmap 定的 60~90, 取上限让实测细节装得下 */
export const HANDS_ON_TARGET_SEC = 90;
