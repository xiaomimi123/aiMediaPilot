/**
 * 三十八期 Task 5: 支柱覆盖检查 —— 纯函数, 只提示不重生成。
 *
 * 快照里某支柱在 30 天里一次没出现, 说明这份规划实际上偏科了(哪怕生成时
 * prompt 里要求了均衡分布, LLM 也可能没照做)。这里只报警告文案, 不做任何
 * 自动纠正 —— 重生成/换选题是用户自己的决定, 代码不该替他做。
 */

export interface PillarLike {
  name: string;
}

export interface PlanDayLike {
  pillarName: string;
}

export function pillarCoverageWarnings(pillars: PillarLike[], days: PlanDayLike[]): string[] {
  const usedNames = new Set(days.map((d) => d.pillarName));
  return pillars
    .filter((p) => p.name && !usedNames.has(p.name))
    .map((p) => `内容支柱「${p.name}」在这 30 天里一次都没出现`);
}
