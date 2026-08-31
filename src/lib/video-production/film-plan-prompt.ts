import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';
import type { ScriptAct } from '@/lib/script/six-act';

/**
 * FilmPlan 提示词(二十七期)。
 *
 * 与旧链 Director/Builder 的关键差异: **模型不写代码、也不写坐标**, 只做三件事——
 * 把一幕拆成几镜、每镜选一张卡、把槽位填上真话。版面与动效由 `remotion/src/cards/`
 * 的固定组件决定(见 spec §2)。
 */

export type ActWindow = {
  act: string;
  title: string;
  startMs: number;
  endMs: number;
  narration: string;
};

/**
 * 幕时间窗。
 *
 * 口径必须与 `synthesizeSrtFromSixActScript`(见 srt-synthesis.ts)一致 —— 那个函数
 * 就是按 `targetSec` 逐幕累加铺 SRT 的。两边口径一旦分叉, 画面会和字幕/配音错位,
 * 而且**不会有任何报错**。
 *
 * 这里曾经写过 `Math.round(a.targetSec * 1000)`, 理由是"`targetSec` 恒为整数,
 * round 只是无害的防御性写法"。这个前提只在 `SixActScriptSchema`(six-act.ts,
 * `z.number().int()`)里成立——但 Remotion 链实际的读取路径走的是
 * `SixActDraftSchema`(`targetSec: z.number()`, 无整数约束)和工作区自动保存端点
 * (`z.number().min(0)`, 同样无整数约束), 这两个真正的把关点都不保证整数。一旦
 * 有分数秒的 targetSec 进来, 这里的 Math.round 就是**唯一**让本函数与
 * `synthesizeSrtFromSixActScript`(那边的累加是 `cursorMs += targetMs`, 没有
 * round)在幕边界上分叉的地方——分叉是静默的, 没有任何报错。所以去掉它: 时间窗
 * 带小数远好过两边悄悄对不上。
 */
export function actWindows(acts: ScriptAct[]): ActWindow[] {
  let cursorMs = 0;
  return acts.map((a) => {
    const startMs = cursorMs;
    cursorMs += a.targetSec * 1000;
    return { act: a.act, title: a.title, startMs, endMs: cursorMs, narration: a.narration };
  });
}

/**
 * 收口用的宽松 schema。
 *
 * **故意不在这里用严格的 FilmPlanSchema** —— 后续的 `callStructured` 会自己按严格
 * schema 重试并在失败时抛错, 那样我们就拿不到模型的原始产出, 也就没法把**精准的**
 * 校验错误喂回去做修复循环。修复循环的价值全在错误信息的措辞上, 所以这一层只保证
 * "拿到一个带 shots 数组的对象", 真正的严格校验交给后续任务(film-plan-builder.ts)。
 */
const LooseFilmPlanSchema = z.object({ shots: z.array(z.any()) });

export const FILM_PLAN = {
  /**
   * `cardsSection` 必须是 `describeCardsForPrompt()` 的原文——卡片库是唯一事实来源,
   * 这里绝不能另写一套卡片描述(两份描述必然会分叉, 而且分叉不会报错)。
   */
  buildSystemPrompt(cardsSection: string, factsSection: string): string {
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    return `你是一个知识类短视频的"画面编排者"。你不写代码、不写坐标、不选颜色——画面由固定的卡片组件渲染，你只负责把内容拆成一镜一镜，为每一镜选一张卡片，并把槽位填上。

${cardsSection}

时间轴规则：
- 下面会给你每一幕的时间窗（起止毫秒）与台词。**把每一幕拆成 1~4 镜**，让画面跟着台词走，不要一幕只给一镜。
- 每一镜的 startMs/endMs 必须落在它所属那一幕的时间窗之内，**幕内首尾相接铺满、不留空档**（留空档观众看到的就是黑屏）。
- 镜与镜之间**不许重叠**。
- 每一镜至少 1200 毫秒——比这更短观众读不完；但如果某一幕本身的时间窗就短于 1200 毫秒，就用一镜铺满这一幕，铺满不留空档永远优先于这条下限。
${factsBlock}

只输出 JSON，不要 markdown 代码块标记，不要解释文字。顶层字段只有一个：shots（数组）。每一镜的字段是 shotId、startMs、endMs、card、slots。`;
  },

  buildUserMessage(windows: ActWindow[]): ContentPart[] {
    const body = windows
      .map((w) => `【${w.title}】${w.startMs} ~ ${w.endMs} 毫秒\n${w.narration}`)
      .join('\n\n');
    return [{ type: 'text', text: `逐幕台词与时间窗：\n\n${body}\n\n请给出完整的分镜填槽方案。` }];
  },

  responseSchema: LooseFilmPlanSchema,
};
