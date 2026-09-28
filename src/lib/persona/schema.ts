import { z } from 'zod';

const text = z.string().default('');
const OFFERING_TYPES = ['tool', 'service', 'course', 'other'] as const;

export const PersonaSchema = z.object({
  audience: text,
  targetFans: text,
  angle: text,
  avoid: text,
  systemSummary: text,
  pillars: z.array(z.object({ name: z.string().trim().min(1, '内容支柱要有名称'), description: text })).default([]),
  painPoints: z.array(z.object({ pain: z.string().trim().min(1, '痛点不能为空'), evidence: text })).default([]),
  offerings: z
    .array(
      z.object({
        name: z.string().trim().min(1, '产品要有名称'),
        type: z.string().transform((t) => ((OFFERING_TYPES as readonly string[]).includes(t) ? (t as (typeof OFFERING_TYPES)[number]) : 'other')),
        targetPain: text,
        description: text,
      }),
    )
    .default([]),
});

export type Persona = z.infer<typeof PersonaSchema>;

export const EMPTY_PERSONA: Persona = {
  audience: '',
  targetFans: '',
  angle: '',
  avoid: '',
  systemSummary: '',
  pillars: [],
  painPoints: [],
  offerings: [],
};
