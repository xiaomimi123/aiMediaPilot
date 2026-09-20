import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';
import { OVERLAY_KINDS, KIND_PARAMS } from '@/lib/overlay-studio/arrangement';
import type { TranscriptLine } from '@/lib/overlay-studio/arrange';

/**
 * SRT → Overlay Studio 编排的提示词(2026-09-20)。
 *
 * 内容是 overlay-studio 内置 skill(313 行)的**忠实压缩**, 不是重新设计:
 * 分段先行/图形优先/卡点计算/文字量红线/一段一色, 每条都来自原 skill,
 * 丢规则会直接反映成编排质量下降。质量阈值类规则(密度区间/越界/占位)刻意
 * **不写进来** —— 那是 Studio lint 的职责, 修复循环会把它的报错喂回来,
 * 两处各管一半, 不重复定义(阈值用户还能在 Studio 侧 local 覆盖)。
 */

const CARD_TABLE = (Object.entries(KIND_PARAMS) as [string, readonly string[]][])
  .map(([kind, params]) => `- ${kind}: 参数 ${params.join(', ')}`)
  .join('\n');

export const OVERLAY_ARRANGE = {
  buildSystemPrompt(): string {
    return `你是口播视频的动效编排师。输入是逐句字幕(起止秒+文本), 输出一份 Overlay Studio 编排 JSON。
动效卡是预制的, 你只做两件事: 挑卡、对时间。**严禁发明卡片类型和参数字段。**

## 可用卡片(kind → 专有参数)
${CARD_TABLE}
通用参数(所有卡): theme, offsetX, offsetY, accent, scale, speed, dimAt, dimMode。
accent 只能取: blue(事实/数据) / alert(痛点/否定) / orange(转折/情绪)。

## 编排方法(顺序执行)
1. **先分段再配卡**: 把全稿拆成 3-6 章(每章 10-30 秒一个论点), 严禁逐句挑卡。
2. **常驻层**: chapter-bar 一张(start=0, end=全片, chapters 填「章名 起始秒」用 | 分隔, 切换点选自然转折句);
   caption-track 一张(lines 一行一条「起始|结束|中文|英文」, 中文从原句轻度整理去语气词,
   每条给短而地道的英文, 每条至少一处 *关键词* 标注; 文本里不许出现竖线)。
3. **一段一结构**: 每段最多一张标志性主卡 + 零散要点用 pin-board 钉角落; 段内只进不出, 段界同段全体清场(共用 end)。
4. **图形优先(防 PPT 化)**: 数字/比例 → ring-metric/odometer/stat-proof/growth-curve; 二选一 → versus-card;
   列举 → pin-board/checklist; 引用 → quote-lockup; 讲到具体人/公司 → entity-chips;
   纯文字卡(punch-pill/blur-text/type-shift)只给钩子/反转/金句时刻。
5. **卡点计算(硬规则)**: 逐条出现的卡(stepMs/staggerMs/shiftAtMs/countMs)节奏必须用字幕实际时长推算:
   参数 ≈ 对应段总时长(秒)×1000 ÷ 条目数, 再略减 10%。不许用默认值。
6. **文字量红线**: 禁止把字幕原句整句搬上卡, 必须提炼成词块, 明显短于口播原句。
7. **一段一色**: 同段所有卡 accent 一致; 同一语义整期同色。
8. **落位避人**: 人物在画面中间, 卡落 left/right/top, 不盖脸。同屏内容卡不超过 2 张(常驻卡除外), 进场彼此错开 ≥0.5s。
9. **相邻两张内容卡不许同 kind**(常驻卡除外)。
10. **dimAt**: 给每张证据/论点卡填 dimAt = 下一话题开始秒(讲过变浅让位不退场)。
11. **来源行**: 证据卡带出处(stat-proof 的 footZh、quote-lockup 的 author), 仿「CASE·博主自述」格式。
12. **宁多毋缺**: 拿不准要不要配卡的段落一律配上(编辑台删卡只要一下, 补卡要重新对时间)。
13. **钩子**: 开头 0-5 秒必须有一张钩子卡; 每个总结/反转/数字时刻都配卡。

## 输出
只输出 JSON 对象: { "version": 1, "theme": "dark"|"light", "cards": [...] }。
每张卡: { "id": "card-N"(递增不重复), "kind": 卡片库里的 kind, "start": 秒, "end": 秒, "seg": 可选段组名, "params": {...} }。
start/end 必须来自字幕的真实时间, end 大于 start, 不许超过全片时长。params 只写要覆盖的字段。`;
  },

  buildUserMessage(segments: TranscriptLine[], durationSec: number): ContentPart[] {
    const lines = segments
      .map((s) => `${s.startSec.toFixed(1)}|${s.endSec.toFixed(1)}|${s.text}`)
      .join('\n');
    return [{
      type: 'text',
      text: `全片时长 ${durationSec.toFixed(1)} 秒。原片没有烧录字幕(所以需要 caption-track)。画面偏亮, theme 用 dark。\n`
        + `逐句字幕(起始秒|结束秒|文本):\n${lines}`,
    }];
  },

  /**
   * 结构宽松版 schema —— callStructured 需要一个响应形状引导 JSON mode,
   * 真正的严格校验(kind 枚举/参数白名单/id 唯一)在 OverlayArrangementSchema,
   * 分工与 FilmPlan 的「responseSchema 宽、FilmPlanSchema 严」同一先例。
   */
  responseSchema: z.object({
    version: z.number(),
    theme: z.string(),
    cards: z.array(z.object({
      id: z.string(),
      kind: z.string(),
      start: z.number(),
      end: z.number(),
      seg: z.string().optional(),
      params: z.record(z.unknown()),
    })),
  }),
} as const;

/** 供测试与文档引用: 卡片清单一份真源。 */
export const OVERLAY_KIND_LIST = OVERLAY_KINDS;
