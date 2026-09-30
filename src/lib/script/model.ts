import { z } from 'zod';

/**
 * 口播稿固定 6 段(沿用旧版验证过的六幕结构)。占比决定每段的时长预算,
 * 60 秒时为 6 / 13.5 / 13.5 / 9 / 13.5 / 4.5 秒。
 */
export const SEGMENT_ROLES = ['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close'] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const ROLE_LABEL: Record<SegmentRole, string> = {
  hook: '开场钩子',
  conceptA: '概念A',
  conceptB: '概念B',
  fact: '冷知识',
  bridge: '知识串联',
  close: '金句收尾',
};

export const ROLE_SHARE: Record<SegmentRole, number> = {
  hook: 0.1,
  conceptA: 0.225,
  conceptB: 0.225,
  fact: 0.15,
  bridge: 0.225,
  close: 0.075,
};

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
