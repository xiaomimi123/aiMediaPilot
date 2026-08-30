/**
 * 元素遮挡检查(二十四期)。
 *
 * 补的是体检里缺的一维: **元素之间的关系**。
 *
 * 现有五道关 —— 空屏、空壳色块、版面、文字被裁、整片静止 —— 每一道看的都是
 * 「某个元素自己怎么样」, 没有一道看「两个元素撞没撞上」。真实缺陷: 成片第 20 秒
 * 顶部标题「差距不在技术，在提问」被两张卡片压住, 「差距」二字完全被盖掉, 一路进了成片。
 *
 * 判据读 DOM 真实几何(矩形相交), 不从像素猜 —— 从像素猜文字有没有被盖是个死胡同,
 * 这个项目在并排检测上已经绕过两圈才回到读 DOM(见 frame-layout.ts)。
 */

export interface OccludedText {
  /** 这段文字被其它不透明元素盖住的面积比例 0~1。 */
  coverRatio: number;
  /** 被盖住的文字, 报告里要说出来 —— 只说"有遮挡"没法定位。 */
  text: string;
}

/**
 * 盖住多少算不合格。
 *
 * 15% 偏宽松是故意的: 这一维刚接上, 先让它**能报出来**。密度阈值当初就是因为第一次
 * 标定太紧, 反复返工了三轮; 收紧要等有了真实分布再说。
 */
export const MAX_COVER_RATIO = 0.15;

export function judgeOverlap(
  samples: { occluded: OccludedText[] }[],
): { ok: boolean; reason?: string } {
  const worst = samples
    .flatMap((s) => s.occluded)
    .filter((o) => o.coverRatio > MAX_COVER_RATIO)
    .sort((a, b) => b.coverRatio - a.coverRatio)[0];

  if (!worst) return { ok: true };
  return {
    ok: false,
    reason:
      `有文字被其它元素盖住: 「${worst.text.slice(0, 20)}」被覆盖 ` +
      `${Math.round(worst.coverRatio * 100)}%。把它挪开或调整层级, 不要让文字压在卡片下面。`,
  };
}
