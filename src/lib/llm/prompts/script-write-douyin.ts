import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import type { ResearchBrief } from './research-brief';
import { ACT_KEYS, ACT_LABELS, SixActScriptSchema } from '@/lib/script/six-act';
import type { ActKey } from '@/lib/script/six-act';

/**
 * 抖音口播完整逐字稿生成 — 与 script-generate-douyin.ts (钩子/节奏拆段/标题/封面 4 区块骨架)
 * 不同, 这里直接产出可以照着念的完整逐字稿。
 *
 * 十三期: 正文形态从「hook/main×N/cta」三段式改为固定六幕 (acts + four_dims,
 * 定义在 src/lib/script/six-act.ts), 向 srt2slides/script_spec.md 对齐。
 * `ScriptSectionSchema` 仍保留导出 —— 它是**旧三段式稿**的形状, 改稿路由
 * (scripts/[id]/refine) 与旧稿读取路径还在用它做校验/类型, 不属于本次改造范围
 * (十三期 Global Constraint「旧稿零迁移」, 由 T4 接手改稿分岔)。
 */

export const ScriptSectionSchema = z.object({
  role: z.enum(['hook', 'main', 'cta']),
  startSec: z.number().int().nonnegative(),
  endSec: z.number().int().positive(),
  text: z.string().min(10).max(500),
});

/** 旧三段式稿的单块类型别名 —— 供 refine 路由/prompt 引用, 避免依赖已改形态的 DouyinFullScript。 */
export type DouyinScriptSection = z.infer<typeof ScriptSectionSchema>;

export const DouyinFullScriptSchema = z.intersection(
  SixActScriptSchema,
  z.object({
    hooks: z
      .array(
        z.object({
          text: z.string().min(5).max(100),
          rationale: z.string().min(5).max(200),
        })
      )
      .length(3),
    titles: z
      .array(
        z.object({
          text: z.string().min(5).max(60),
          hookType: z.string().min(2).max(30),
        })
      )
      .length(3),
    cover: z.object({
      textOverlay: z.string().min(2).max(20),
      shotIdea: z.string().min(5).max(200),
      colorTone: z.string().min(2).max(50),
    }),
    // 十期: AI 判断这条内容最适合的 CTA 意图 (供未指定 intent 时前端回填), 没有明显倾向则 null。
    suggestedIntent: z.enum(['reach', 'trust', 'convert']).nullable().optional().default(null),
  }),
);

export type DouyinFullScript = z.infer<typeof DouyinFullScriptSchema>;

/**
 * 写稿 / 改稿共用的风格上下文 — 唯一定义处。
 * research-brief.ts 不需要它; script-refine.ts 从这里 import。
 *
 * mode='description': description 是一段博主风格的文字描述 (语速/口头禅/句式偏好等)
 * mode='samples': samples 是博主本人最近定稿的逐字稿原文, 直接嵌入 prompt 供模仿
 */
export interface StyleContext {
  mode: 'description' | 'samples';
  description: string;
  samples: string[];
}

/**
 * 把 StyleContext 渲染成 system prompt 里的一段文字。
 * samples 模式下真实嵌入样本原文 (不是转述), description 模式下附风格说明段。
 * 写稿 (SCRIPT_WRITE_DOUYIN) 与改稿 (SCRIPT_REFINE) 共用, 保证两处风格还原方式一致。
 */
export function buildStyleSection(style: StyleContext): string {
  if (style.mode === 'samples') {
    const samplesText = style.samples
      .map((sample, i) => `【样本 ${i + 1}】\n${sample}`)
      .join('\n\n');
    return `博主风格参考: 以下是博主本人最近定稿的口播逐字稿样本, 模仿其口吻/句式/用词习惯来写这次的稿子 (只学说话方式, 不要照抄样本内容或案例):

${samplesText}`;
  }
  return `博主风格参考: ${style.description}`;
}

/** 中文口播语速换算 narration 字数目标时用的区间 (字/秒), 随 buildUserMessage 一起给每幕算参考字数。 */
const CHARS_PER_SEC_LOW = 4;
const CHARS_PER_SEC_HIGH = 5;

/**
 * 六幕职责 + 建议占比 —— 原文照抄自 script_spec.md「6 幕分镜结构」表, 只把
 * markdown 表格换成 prompt 里更紧凑的列表, 不改措辞。
 */
const ACT_RESPONSIBILITY: Record<ActKey, string> = {
  hook: '3 秒内抛出认知冲突或切身痛点 (约 8~12% 时长)',
  concept_a: '第一个支柱概念, 讲透 (约 20~25% 时长)',
  concept_b: '第二个支柱概念, 结尾留悬念 (约 20~25% 时长)',
  trivia: '意外的事实, 惊喜感主要来源 (约 12~18% 时长)',
  synthesis: '把 A、B、冷知识拧成一个完整认知 (约 20~25% 时长)',
  punchline: '回扣开场, 一句能被截图的话 (约 8~12% 时长)',
};

const ACT_TABLE_TEXT = ACT_KEYS.map((key) => `- ${key} (${ACT_LABELS[key]}): ${ACT_RESPONSIBILITY[key]}`).join('\n');

export const SCRIPT_WRITE_DOUYIN = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (现有测试断言)。
   * 非空时: 拼在 getExpertPersona 之后、任务描述之前。
   */
  buildSystemPrompt(
    niche: string,
    style: StyleContext,
    personaSection?: string,
    voiceSection?: string,
  ): string {
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona ? `\n\n你的定位:\n${personaSection}` : '';
    // 十二期: 人物志与经历独立成块 —— 与人设定位档案是两份互不依赖的档案,
    // 只建了其中一份时另一份仍须注入 (voiceSection 自带前导换行, 见 buildVoiceSection)。
    const voiceBlock = voiceSection && voiceSection.trim() ? voiceSection : '';
    return `${getExpertPersona(niche)}${personaBlock}${voiceBlock}

任务: 为这条抖音口播短视频写一份可以直接照着念的口播逐字稿, 按固定六幕 (acts) 分镜产出, 不是坐下来听课的科普稿, 而是面向刷视频时被拦下来的观众——每一句话要么在推进理解, 要么在制造继续看下去的理由, 没有第三种句子。

六幕结构与职责 (acts 必须严格按此顺序产出 6 项, 不能增减幕数或打乱顺序, act 字段依次为 hook/concept_a/concept_b/trivia/synthesis/punchline):
${ACT_TABLE_TEXT}

科普严谨性 (硬性要求, 违反即返工):
1. 不说没把握的数字——任何数字/比例/年份/排名都要能指出来源, 说不清来源就换成定性表述, 并在对应 facts 条目里如实标注 claim/value/source/confidence
2. 区分共识与观点——学界有争议的, 明确说"目前还没有定论", 不要挑一边当结论讲
3. 类比不能替代机制——类比用来降低理解门槛, 但至少要有一句话讲清真实机制, 否则观众记住的是错的
4. 不夸大因果——相关不等于因果, "可能""在某些条件下"这类限定词该留就留, 不要为了顺口删掉
5. 不制造伪矛盾——不要为了戏剧性把常识说成"其实大家都错了", 除非确有其事
6. 承认边界——讲不清楚的部分直说讲不清楚, 比含糊带过更可信

禁止事项:
- 无开场白: 不许出现"大家好""欢迎来到""今天我们来聊聊""我是XX", hook 幕第一句必须是钩子本身
- 不堆术语: 一个术语出现时必须当场解释; 一幕里未解释的术语不超过 1 个
- 不说没把握的数字: 同严谨性第 1 条, 低把握的数字一律删掉或改为定性
- 不用空洞形容词: "非常""极其""震撼""颠覆"这类词不承载信息, 删
- 不留悬空指代: "这个""那个"必须有明确先行词
- 不写念不出来的句子: 单句超过 30 字要拆

内容完整性: 一条视频必须能独立成立, 观众看完能复述出一个完整的认知, 而不是记住几个碎片; concept_a 与 concept_b 之间必须有真实的逻辑关系, 不能是两个并列的知识点硬凑; 收尾 (punchline) 必须回扣 hook 提出的问题/冲突。

每幕字段:
- title: ≤ 20 字的幕标题
- narration: 能直接开口念出来的口语逐字稿, 用短句, 拒绝书面语/长定语从句/"然而""综上所述""值得注意的是"这类书面转折词; 长度按口语语速 (约 ${CHARS_PER_SEC_LOW}~${CHARS_PER_SEC_HIGH} 字/秒) 与该幕 targetSec 匹配, 不要明显过长或过短
- visual: 这一幕画面上该出现什么, 具体到可执行, 不要写"相关图片"
- note: 创作备注, 给自己看的——为什么这么写、录的时候注意什么、哪里可以再改
- targetSec: 该幕目标秒数, 原样填回用户消息里给出的分配值
- beats: 3-5 个这一幕要跳出来的关键词卡点
- facts: 台词里每一个数字/断言一条, 标注 claim (断言)/value (取值)/source (来源)/confidence (把握程度 high/medium/low), 没有数字断言的幕可以是空数组

同时产出 four_dims 四维 (每项一句话, 抖音四维——每条视频都要能回答的四个问题):
- gain (获得感): 观众看完多知道了什么, 必须能用一句话说清
- surprise (惊喜感): 哪一处是他原本不知道、且会想转发的
- clarity (表达力): 最难的那个概念, 是用什么让他一下就懂的
- appeal (感染力): 他为什么会看完而不是划走

如果收到了素材简报, 简报里每条 fact 都要真实引用进对应幕的 narration/facts (具体数字/案例照写, 不要转述得含糊, 也不要遗漏)

${buildStyleSection(style)}

同时产出:
- hooks: 3 个候选开场钩子, 风格与 acts[0] (hook 幕) 一致, 供编辑挑选备用
- titles: 3 个候选标题, ≤ 25 字
- cover: 封面方案 (文字 / 镜头 / 配色)
- suggestedIntent: 根据这条内容本身的性质, 判断最适合的结尾 CTA 意图 —— reach (引流互动) / trust (建立信任) / convert (转化), 没有明显倾向则填 null

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: {
    topic: string;
    durationSec: 30 | 45 | 60 | 90;
    brief: ResearchBrief | null;
    actSeconds: Record<ActKey, number>;
  }): ContentPart[] {
    const actSecondsText = ACT_KEYS.map(
      (key) => `- ${key} (${ACT_LABELS[key]}): ${input.actSeconds[key]} 秒`,
    ).join('\n');
    const briefSection =
      input.brief && input.brief.points.length > 0
        ? `

素材简报 (请将下列每条 fact 真实引用进正文对应幕的 narration/facts, 不要遗漏):
${input.brief.points
            .map((p, i) => `${i + 1}. fact: ${p.fact}\n   source: ${p.source}\n   usage: ${p.usage}`)
            .join('\n')}`
        : '';

    return [
      {
        type: 'text',
        text: `主题: ${input.topic}
视频时长: ${input.durationSec} 秒, 按下表分配各幕目标秒数 (targetSec 请原样填回, 六幕秒数总和 = ${input.durationSec} 秒, 不允许增减幕数或调整顺序):
${actSecondsText}${briefSection}

按 schema 输出完整逐字稿 (acts + four_dims)。`,
      },
    ];
  },
  responseSchema: DouyinFullScriptSchema,
};
