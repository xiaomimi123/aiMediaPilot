/**
 * 出片走哪条渲染链的缺省规则(任务四: 给 Remotion 链配上人声之后开的第一个入口)。
 *
 * 只有 `ppt-narration` 迁到了 Remotion(带人声的新链); talking-head-broll/
 * illustration-tts 另两条还没迁, 缺省仍然是 legacy。
 *
 * 缺省提级刻意放在路由层, 不动 `prisma/schema.prisma` 里 `renderer` 字段的
 * `@default("legacy")` —— 万一新链出问题, 回退只改这一个函数, 不用碰 schema/迁移。
 */
export function defaultRendererForMode(mode: string): 'remotion' | 'legacy' {
  return mode === 'ppt-narration' ? 'remotion' : 'legacy';
}
