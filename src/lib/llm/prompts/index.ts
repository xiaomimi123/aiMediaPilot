/**
 * Prompts barrel — 集中 re-export 所有 prompt 模块的公开 API,
 * 收敛之前散落在 workers / routes / components 里 11 处逐个具体路径的 import。
 *
 * 一处新增/改名 prompt 只需要动这个文件, 消费方 import 稳定。
 * 具体 module 里的内部 helper (未 export) 不再暴露。
 */

// 4 维评估 (content-analyze-worker 用)
export * from './hook';
export * from './retention';
export * from './title-caption';
export * from './cover';
export * from './synthesize';

// 复盘落差
export * from './retro-gap';

// 3 平台脚本生成
export * from './script-generate-douyin';
export * from './script-generate-xiaohongshu';
export * from './script-generate-gongzhonghao';

// 灵感 → 共性洞察 (→ 风格透传下次生成)
export * from './inspiration-insight';
export * from './style-hints';

// 主题发现 (零输入选题池)
export * from './topic-discovery';

// 标题实时评估 (发前 checklist)
export * from './title-critique';

// 热点雷达 — 阅读评分 (全网文章 → 选题价值评估)
export * from './radar-read';

// 通用: expert persona / JSON strictness
export * from './expert-persona';
export { JSON_STRICTNESS } from './base';
