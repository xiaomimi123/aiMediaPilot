import { z } from 'zod';

/**
 * 口播稿固定 6 段, 按讲故事的节拍: 钩子 → 我是谁·当时 → 遇到什么 → 怎么做的 → 结果 → 经验或悬念。
 * 键名沿用旧的六幕结构(已存的稿子不用迁移), 只改显示名与占比; 占比只作每段参考时长。
 */
export const SEGMENT_ROLES = ['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close'] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const ROLE_LABEL: Record<SegmentRole, string> = {
  hook: '钩子',
  conceptA: '我是谁·当时',
  conceptB: '遇到什么',
  fact: '怎么做的',
  bridge: '结果',
  close: '经验或悬念',
};

export const ROLE_SHARE: Record<SegmentRole, number> = {
  hook: 0.1,
  conceptA: 0.15,
  conceptB: 0.2,
  fact: 0.2,
  bridge: 0.25,
  close: 0.1,
};

/** 新作品、每日选题、润色的默认目标时长(秒) */
export const DEFAULT_TARGET_SEC = 75;

export interface Segment {
  id: string;
  role: SegmentRole;
  text: string;
}

export interface Script {
  segments: Segment[];
}

export const ScriptSchema: z.ZodType<Script> = z.object({
  segments: z
    .array(z.object({ id: z.string().min(1), role: z.enum(SEGMENT_ROLES), text: z.string() }))
    .length(SEGMENT_ROLES.length),
});
