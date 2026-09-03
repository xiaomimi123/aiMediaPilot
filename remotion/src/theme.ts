import {C} from './motion/lib';

/**
 * 卡面视觉风格 token(二十九期 Task 1)。
 *
 * 背景: illustration-tts 交付链要迁到 Remotion。旧链的"插画感"是 Builder
 * 提示词层的风格化排版(已核实无图片生成)，新链改用同一套四张卡 + 一组不同的
 * 视觉 token 来承载这个风格差异——模型只管填槽，`FilmPlanSchema`/
 * `describeCardsForPrompt` 都不知道 `visualStyle` 的存在，风格纯粹是渲染层的事。
 *
 * **不是 `remotion/src/motion/theme.ts`。** 那份文件是 video-talkcraft 搬来的
 * 深空色系，README 明确"不允许有任何 importer"，现状零引用，本文件不动它也不
 * 复用它——这里是这个项目自己另建的一层主题，两者刻意毫无关系。
 *
 * `illustration` 从 `motion/lib.tsx` 的调色板 `C`(纸白/墨蓝/黄红系，那是
 * video-talkcraft 的另一套设计语言，已获书面授权可商用)**派生**——只是换了
 * 几个角色的取值组合，拉出"暖纸底、手写记号笔感标题"的方向，没有引入这个
 * 色系之外的新颜色系统。
 */
export type CardTheme = {
  /** 卡面背景基色。 */
  background: string;
  /** 标题/主文案色。 */
  title: string;
  /** 强调色——label、分隔件等次级强调用。 */
  accent: string;
  /** 强调数字/序号色(Stat 主数字、ListCard 序号)。 */
  highlight: string;
  /** 强调数字的描边色(WebkitTextStroke)。 */
  stroke: string;
  /** 注脚/弱化文案色，已含透明度(不再需要外层再叠一层 opacity)。 */
  footnote: string;
};

export const THEMES: Record<'card' | 'illustration', CardTheme> = {
  /** card: 四张卡目前写死的配色原样收编成 token——冷静克制的"打印感"。 */
  card: {
    background: C.paper,
    title: C.ink,
    accent: C.blue,
    highlight: C.yellow,
    stroke: C.ink,
    footnote: 'rgba(26,26,46,0.55)', // = C.ink 在 0.55 不透明度, 与 Stat.note 现状一致
  },

  /**
   * illustration: 暖纸底 + 手写记号笔感标题, 与 card 拉开肉眼可辨的差距。
   * - background 从 C.paper 朝 C.yellow 方向加暖(旧纸/水彩纸质感), 不是纸白。
   * - title 用 C.red 而不是 C.ink——记号笔手写感的暖色标题, 替代打印体的冷墨蓝。
   * - accent 用 C.lightBlue(比 C.blue 柔和), 避免鲜蓝在暖背景上过于刺眼。
   * - stroke 用 C.white 描边(而不是 card 的墨蓝描边)，数字压在暖背景上时
   *   仍需要一圈浅色描边才不会糊进背景里。
   * - footnote 跟着 title 走暖色调(红系低透明度)，与 card 的灰调注脚区分开，
   *   让整体呈现"暖色系一套到底"而不是"局部贴了暖色的冷色系卡片"。
   */
  illustration: {
    background: '#f7e8c8',
    title: C.red,
    accent: C.lightBlue,
    highlight: C.yellow,
    stroke: C.white,
    footnote: 'rgba(239,84,54,0.5)', // = C.red 在 0.5 不透明度
  },
};
