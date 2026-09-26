import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { applySegmentEdit } from '@/lib/script/edit';
import { checkDuration, estimateSec } from '@/lib/script/duration';
import type { Tool } from './types';

const Input = z.object({
  segmentId: z.string().min(1).describe('要改的段落编号, 如 s4'),
  text: z.string().min(1).describe('这一段改后的完整逐字稿'),
});

export const patchScriptTool: Tool<z.infer<typeof Input>> = {
  name: 'patch_script',
  description: '只替换稿子里指定编号的一段, 其他段落不动。返回改后的时长检查结果；仍超标时 issues 里有具体数值。',
  input: Input,
  async execute(ctx, input) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const parsed = ScriptSchema.safeParse(project.script);
    if (!parsed.success) return { ok: false, summary: '改稿失败：还没有稿子，先写一版' };
    const before = parsed.data.segments.find((s) => s.id === input.segmentId);
    let next;
    try {
      next = applySegmentEdit(parsed.data, input.segmentId, input.text);
    } catch (e) {
      return { ok: false, summary: `改稿失败：${e instanceof Error ? e.message : String(e)}` };
    }
    await ctx.db.project.update({
      where: { id: ctx.projectId },
      data: { script: next as unknown as Prisma.InputJsonValue },
    });
    const report = checkDuration(next, project.targetSec);
    const seg = report.segments.find((s) => s.id === input.segmentId)!;
    return {
      ok: true,
      summary: `改稿：第${seg.index}段「${ROLE_LABEL[seg.role]}」${estimateSec(before!.text)}s → ${seg.estSec}s`,
      segmentIds: [input.segmentId],
      data: { durationOk: report.ok, totalSec: report.totalSec, issues: report.issues },
    };
  },
};
