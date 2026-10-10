import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { writeScript } from '@/lib/script/write';
import { formatPersona, type PersonaLike, type Tool } from './types';
import { formatReference, loadReference } from '@/lib/benchmark/adopt';
import { copiedSummary, findCopiedInScript } from '@/lib/benchmark/copy-check';
import { formatLessons, loadActiveLessons } from '@/lib/retro/lessons';
import { recentSampleTexts } from '@/lib/voice/samples';

const Input = z.object({
  direction: z.string().min(1).describe('这条视频讲什么、从什么角度切入、用什么例子'),
  targetSec: z.number().int().min(15).max(180).optional().describe('目标时长(秒), 不传则用项目当前目标'),
});

export const writeScriptTool: Tool<z.infer<typeof Input>> = {
  name: 'write_script',
  label: '写稿',
  description: '按方向写一整版 6 段口播稿并保存到项目(会覆盖当前稿子)。只在还没有稿子或用户要求重写时用；局部修改用 patch_script。',
  input: Input,
  async execute(ctx, input) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const targetSec = input.targetSec ?? project.targetSec;
    const persona = (project.personaSnapshot as PersonaLike | null) ?? null;
    const ref = await loadReference(ctx.db, project.benchmarkVideoId ?? null);
    const lessons = await loadActiveLessons(ctx.db);
    const { title, script, report, rounds } = await writeScript({
      llm: ctx.llm,
      direction: input.direction,
      targetSec,
      personaText: formatPersona(persona),
      reference: ref ? formatReference(ref) : undefined,
      lessons: lessons.length ? formatLessons(lessons) : undefined,
      samples: await recentSampleTexts(ctx.db),
    });
    await ctx.db.project.update({
      where: { id: ctx.projectId },
      data: {
        script: script as unknown as Prisma.InputJsonValue,
        targetSec,
        ...(project.title === '未命名项目' ? { title } : {}),
      },
    });
    const copied = ref ? findCopiedInScript(script, ref.transcript) : [];
    const summary =
      (report.ok ? `写稿：6 段，约 ${report.totalSec} 秒` : `写稿：约 ${report.totalSec} 秒，自修 ${rounds} 轮后仍超出目标 ${targetSec} 秒`) +
      copiedSummary(copied);
    return {
      ok: true,
      summary,
      segmentIds: script.segments.map((s) => s.id),
      data: { title, durationOk: report.ok, totalSec: report.totalSec, issues: [...report.issues, ...report.hints], copied },
    };
  },
};
