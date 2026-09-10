import type { ContentPart } from '@/lib/llm/vision';
import { JSON_STRICTNESS } from './base';

export interface ContentPlanGenerateInput {
  totalDays: number;
  weeklyCadence: number;
  personaSection: string;
  voiceSection: string;
}

export const CONTENT_PLAN_GENERATE = {
  buildSystemPrompt(weeklyCadence: number, personaSection: string, voiceSection: string): string {
    const personaBlock = personaSection.trim() ? `\n\n你的定位:\n${personaSection}` : '';
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
