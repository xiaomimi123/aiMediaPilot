import { z } from 'zod';

export const ShotsFileSchema = z.object({
  version: z.literal(1),
  shots: z.array(
    z.object({
      id: z.string().min(1),
      fromSec: z.number().min(0),
      toSec: z.number().positive(),
      intent: z.string(),
      material: z
        .object({
          id: z.string().min(1),
          clipFromSec: z.number().min(0).optional(),
          clipToSec: z.number().positive().optional(),
          speed: z.number().positive().optional(),
        })
        .optional(),
    }),
  ),
});
export type ShotsFile = z.infer<typeof ShotsFileSchema>;

/** 每镜取一个关键帧秒数(开头 1.2 秒或中点, 取早的); only 给了就只取这些镜头(复查时只重出改过的) */
export function stillSecs(file: ShotsFile, only?: string[]): number[] {
  if (only) {
    const ids = new Set(file.shots.map((s) => s.id));
    const missing = only.filter((id) => !ids.has(id));
    if (missing.length) throw new Error(`镜头表里没有：${missing.join('、')}（有：${file.shots.map((s) => s.id).join('、')}）`);
  }
  return file.shots.filter((s) => !only || only.includes(s.id)).map((s) => Math.round(Math.min(s.fromSec + 1.2, (s.fromSec + s.toSec) / 2) * 10) / 10);
}
