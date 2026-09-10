import type { ContentPart } from '@/lib/llm/vision';
import { JSON_STRICTNESS } from './base';
import type { PersonaSnapshot } from '@/lib/content-plan/model';

export interface ContentPlanGenerateInput {
  totalDays: number;
  weeklyCadence: number;
  personaSection: string;
  voiceSection: string;
}

/** 生成/reroll 共享的 "你的定位" 包装 —— 空串时整段跳过, 与既有 personaSection 惯例一致。 */
function personaBlockFrom(personaSection: string): string {
  return personaSection.trim() ? `\n\n你的定位:\n${personaSection}` : '';
}

/**
 * Task 3(reroll): 把规划的人设快照渲染成与 `buildPersonaSection(profile, 'topic')`
 * 同风格的文字段 —— reroll 不重读档案(快照一致性是设计红线), 只能从
 * `ContentPlan.personaSnapshot` 里现有的四个字段(audience/pillars/angle/avoid)拼装。
 */
function renderPersonaSnapshotSection(snapshot: PersonaSnapshot): string {
  const lines: string[] = [];
  if (snapshot.audience.trim()) lines.push(`目标受众: ${snapshot.audience}`);
  if (snapshot.pillars.length > 0) {
    lines.push('内容支柱:');
    for (const pillar of snapshot.pillars) lines.push(`- ${pillar.name}: ${pillar.description}`);
  }
  if (snapshot.angle.trim()) lines.push(`差异化角度: ${snapshot.angle}`);
  if (snapshot.avoid.trim()) lines.push(`避免涉及: ${snapshot.avoid}`);
  return lines.join('\n');
}

export const CONTENT_PLAN_GENERATE = {
  buildSystemPrompt(weeklyCadence: number, personaSection: string, voiceSection: string): string {
    const personaBlock = personaBlockFrom(personaSection);
    const voiceBlock = voiceSection;
    return `你是自媒体内容策略师, 要给博主一次性排出未来 30 天的选题路线, 让他每天打开就有活干, 不用再为"今天做什么"卡住。${personaBlock}${voiceBlock}

任务要求:
1. **只做常青选题**: 不追热点、不编数据、不写任何依赖当下时效性的内容(如"最近发生的 XX 事件"), 30 天后重看依然成立。
2. **按内容支柱轮换覆盖**: 每天的 pillarName 必须是上面列出的内容支柱名之一(逐字匹配), 30 天内让每个支柱都出现足够次数, 不要连续多天扎堆同一个支柱。若定位未列出内容支柱, pillarName 留空字符串。
3. **同一规划内不许撞题**: 30 天的 topic 之间不能重复或明显相似, 角度也要有区分度。
4. **每天三个字段**:
   - topic: 选题标题草稿(3-60 字)
   - angle: 差异化切入角度(3-120 字), 讲清楚从什么视角/立场切入, 不是泛泛的方向
   - hookDirection: 开篇钩子的**方向**而不是完整句子(3-120 字), 例如"数字反差开场"“先抛结论再倒叙”“用一个真实翻车场景开场”, 留给当天写稿时再细化成具体台词
5. 每周节奏参考: 用户计划每周拍 ${weeklyCadence} 条, 但仍需给满 30 天的选题(供他自由挑选执行顺序, 不因为节奏而减少条数)。
6. dayIndex 从 1 到 30, 严格覆盖每一天, 不遗漏不重复。

输出 schema:
- days: 长度必须恰好 30 的数组, 每项含 dayIndex/pillarName/topic/angle/hookDirection

${JSON_STRICTNESS}`;
  },
  buildUserMessage(): ContentPart[] {
    return [
      {
        type: 'text',
        text: '请生成完整 30 天内容规划, 按 schema 输出 days 数组, 恰好 30 条, dayIndex 从 1 到 30 各出现一次。',
      },
    ];
  },
};

export interface ContentPlanRerollInput {
  dayIndex: number;
  personaSnapshot: PersonaSnapshot;
  /** 本天原 topic + 同规划其余天的 topic —— 防止换出来的新选题又撞车。 */
  avoidTopics: string[];
}

/**
 * Task 3: 单天换选题(reroll)的 system/user 消息。输入只吃 `plan.personaSnapshot`,
 * 不重读档案(快照一致性是设计红线) —— 与 `CONTENT_PLAN_GENERATE.buildSystemPrompt`
 * 共享 `personaBlockFrom` 包装, 只是人设文字来自快照渲染而不是外部传入的 personaSection。
 */
export function buildRerollMessages(
  input: ContentPlanRerollInput,
): { systemPrompt: string; userMessage: ContentPart[] } {
  const personaSection = renderPersonaSnapshotSection(input.personaSnapshot);
  const personaBlock = personaBlockFrom(personaSection);
  const avoidList = input.avoidTopics.map((t) => `- ${t}`).join('\n');

  const systemPrompt = `你是自媒体内容策略师, 要给博主已排好的 30 天内容规划里的第 ${input.dayIndex} 天换一个新选题(原选题他不满意, 其余 29 天不动)。${personaBlock}

任务要求:
1. **只做常青选题**: 不追热点、不编数据、不写任何依赖当下时效性的内容, 长期重看依然成立。
2. pillarName 必须是上面"内容支柱"里列出的支柱名之一(逐字匹配); 若定位未列出内容支柱, pillarName 留空字符串。
3. **不能与以下已有选题重复或明显相似**(本天原题 + 规划内其余天的选题, 角度也要有区分度):
${avoidList}
4. 三个字段:
   - topic: 选题标题草稿(3-60 字)
   - angle: 差异化切入角度(3-120 字), 讲清楚从什么视角/立场切入
   - hookDirection: 开篇钩子的**方向**而不是完整句子(3-120 字)
5. dayIndex 固定为 ${input.dayIndex}, 原样返回。

${JSON_STRICTNESS}`;

  const userMessage: ContentPart[] = [
    {
      type: 'text',
      text: `请只给第 ${input.dayIndex} 天换一个新选题, 按 schema 输出单条 dayIndex/pillarName/topic/angle/hookDirection(dayIndex=${input.dayIndex})。务必避开这些已有选题, 不要重复或明显相似:\n${avoidList}`,
    },
  ];

  return { systemPrompt, userMessage };
}
