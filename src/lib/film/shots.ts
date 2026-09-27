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
