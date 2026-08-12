// 三期 T5 平台流水线页 · 分发区数据源。
//
// 两套 "platform" 命名空间在这里桥接 (唯一一处):
//  - cockpit 看板 key: `ContentPlatformEx` 里驱动侧栏 platform-* 分区的 5 个值
//    (src/lib/cockpit/model.ts CONTENT_PLATFORMS)。
//  - Distribution.platform 实际写入值: 分发登记表单用的注册表 key
//    (src/lib/pipeline/platforms.ts DISTRIBUTION_PLATFORMS)。
// 两边 4/5 个值同名，只有 "x" ↔ "twitter" 不一致——统一在这张表里做映射，
// 不在别处 inline 猜测。
//
// 单独抽成 lib (而不是直接 export 在 route.ts 里): Next App Router 对
// `app/**/route.ts` 的导出做类型级白名单校验 (只认 GET/POST/... 和少数几个
// config 导出)，route.ts 里多导出一个普通常量会在 `next dev`/`next build`
// 生成 `.next/types/.../route.ts` 后让 `tsc --noEmit` 报错
// (`Property 'X' is incompatible with index signature`)。
export const COCKPIT_TO_DISTRIBUTION_PLATFORM: Record<string, string> = {
  douyin: 'douyin',
  xiaohongshu: 'xiaohongshu',
  bilibili: 'bilibili',
  x: 'twitter',
  youtube: 'youtube',
};
