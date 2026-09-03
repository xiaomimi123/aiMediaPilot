import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';
import type { ScriptAct } from '@/lib/script/six-act';
import type { AlignedAct } from './aligner-prompt';

/**
 * FilmPlan 提示词(二十八期)。
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
 * 幕时间窗(接 TTS 版)——时间来自真实语音对齐结果 `AlignedAct`, 而不是 `actWindows`
 * 那样按 `targetSec` 估算累加。
 *
 * 为什么不再用 targetSec: `targetSec` 是写稿阶段对朗读时长的估算, 真实 TTS 合成出的
 * 语音时长与它可差数秒(语速、停顿、多音字断句都会让估算偏移)。如果画面时间窗仍按
 * `targetSec` 铺, 而人声按真实时长播放, 两条轴会越走越不同步——观众看到的就是画面
 * 已经翻到下一幕、人声还在念上一幕。接入 TTS 之后, 画面窗口必须以对齐产出的
 * `AlignedAct.startMs/endMs`(真实时长)为准, `targetSec` 只保留给旧的估算链
 * (`actWindows`)和写稿阶段的节奏参考, 不再驱动最终画面时间轴。
 *
 * narration/title 仍取自 `acts`(六幕脚本本身的文字内容, 对齐结果里没有这些字段)。
 * `aligned` 里没有覆盖到的幕(未讲到、被跳过的幕)不产生窗口——没有配音就不该有
 * 对应的画面, 否则会出现一段无声黑屏或复用错的画面。
 */
export function actWindowsFromAligned(acts: ScriptAct[], aligned: AlignedAct[]): ActWindow[] {
  const alignedByAct = new Map(aligned.map((a) => [a.act, a]));
  const windows: ActWindow[] = [];
  for (const act of acts) {
    const window = alignedByAct.get(act.act);
    if (!window) continue;
    windows.push({
      act: act.act,
      title: act.title,
      startMs: window.startMs,
      endMs: window.endMs,
      narration: act.narration,
    });
  }
  return windows;
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

/**
 * FilmPlan 提示词 —— 出镜链专属版本(二十九期 Task 4)。
 *
 * 与 `FILM_PLAN` 的关键差异: **不要求铺满时间轴**。图文口播/插画配音那两条链
 * 没有底层画面, 卡片之间留空档观众就看到黑屏, 所以 `FILM_PLAN` 明确要求
 * "幕内首尾相接铺满、不留空档"。出镜链不一样——画面全程有真人出镜视频铺底,
 * 卡片只是间歇覆盖, 窗口之外观众看到的就是本人在讲话, **这是这条链的正常
 * 观感, 不是要补的缺口**。如果照搬 `FILM_PLAN` 那套"铺满"指令, 模型会被
 * 逼着为每一句无关痛痒的话都编一张卡, 反而破坏了"真人出镜 + 偶尔的信息卡片"
 * 这个交付形式本身的观感。
 *
 * 这段面向模型的文案是新写的(项目铁律: 面向模型的文本只放可执行指令, 不放
 * 背景解释——上面这几段"为什么"只在代码注释里, 不会出现在 `buildSystemPrompt`
 * 的返回值里)。
 */
export const FILM_PLAN_BROLL = {
  buildSystemPrompt(cardsSection: string, factsSection: string): string {
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    return `你是一个真人出镜短视频的"画面编排者"。画面全程是主讲人本人在镜头前说话, 你不写代码、不写坐标、不选颜色——你只负责在值得可视化的片段上挑一张固定的信息卡片盖上去, 把槽位填上。

${cardsSection}

时间轴规则：
- 卡片**不需要铺满整条时间轴**。没有卡片覆盖的时间段, 观众看到的就是本人在讲话——不需要为这些片段编卡片。
- 只在讲到数据、对比、要点小结这类适合可视化的内容时才排一镜；单纯的过渡句、寒暄不需要卡片。
- 每一镜的 startMs/endMs 必须落在它所属那一幕的时间窗之内。
- 镜与镜之间**不许重叠**。
- 每一镜至少 1200 毫秒——比这更短观众读不完。
${factsBlock}

- 至少要挑出 1 个值得做卡片的片段（哪怕只有一镜）。

只输出 JSON，不要 markdown 代码块标记，不要解释文字。顶层字段只有一个：shots（数组）。每一镜的字段是 shotId、startMs、endMs、card、slots。`;
  },

  buildUserMessage: FILM_PLAN.buildUserMessage,

  responseSchema: LooseFilmPlanSchema,
};
