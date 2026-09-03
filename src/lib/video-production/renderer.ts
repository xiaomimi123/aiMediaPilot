/**
 * 出片走哪条渲染链的缺省规则(任务四: 给 Remotion 链配上人声之后开的第一个入口)。
 *
 * 创建路由的缺省值只对 `ppt-narration` 提级到 Remotion; `illustration-tts`
 * 虽然二十九期 Task 2 起 worker 已经能走 Remotion 分支出片(见下方
 * `REMOTION_READY_MODES`), 但缺省仍然是 legacy —— 提级是 Task 6 验收后才做的
 * 独立决定, 跟"这条链本身支不支持 Remotion"是两回事。`talking-head-broll`
 * 两边都还没迁。
 *
 * 缺省提级刻意放在路由层, 不动 `prisma/schema.prisma` 里 `renderer` 字段的
 * `@default("legacy")` —— 万一新链出问题, 回退只改这一个函数, 不用碰 schema/迁移。
 */
export function defaultRendererForMode(mode: string): 'remotion' | 'legacy' {
  return mode === 'ppt-narration' ? 'remotion' : 'legacy';
}

/**
 * 已经迁完、支持走 Remotion 分支出片的交付模式清单(二十九期 Task 2 复审补)。
 *
 * 同一份清单被两处独立消费, 抽出来是为了不让它们分叉:
 * - worker 的 dispatch 选路(`renderer === 'remotion' && isRemotionReadyMode(vp.mode)`)——
 *   判断是否真的有对应的 Remotion handler 能接住这条任务;
 * - `[id]/route.ts` 的 PATCH 切换渲染器——判断是否允许把这条任务切到 `'remotion'`。
 *
 * 各写一份的后果是真实的用户可见 bug: 路由放行了 worker 接不住的 mode, 任务会
 * 卡在没人处理的分支; 或者 worker 明明能接住, 路由却拦着不让用户切过去。
 *
 * 与 `defaultRendererForMode` 是两件不相关的事——那个决定"新建任务默认给哪条链",
 * 这个决定"这条链有没有 Remotion 实现"; `illustration-tts` 在这份清单里但缺省
 * 仍是 legacy, 就是两者不必同步的例证。
 */
export const REMOTION_READY_MODES = ['ppt-narration', 'illustration-tts'] as const;

export function isRemotionReadyMode(mode: string): boolean {
  return (REMOTION_READY_MODES as readonly string[]).includes(mode);
}
