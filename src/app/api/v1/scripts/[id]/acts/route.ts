import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { ACT_KEYS } from '@/lib/script/six-act';

/**
 * 保存六幕稿的正文(前端重建 · 阶段 4)。
 *
 * 之前**没有任何接口能保存改过的稿子内容** —— `[id]` 的 PATCH 只管归档标记。
 * 工作区是自动保存的(不做显式保存按钮), 所以它需要一个自己的落点。
 *
 * 只覆盖 `output.script.acts`, output 的其他部分(four_dims / durationSec /
 * 研究材料等)原样保留 —— 工作区只编辑六幕正文, 不该顺手抹掉别的东西。
 */

const ActSchema = z.object({
  act: z.enum(ACT_KEYS),
  title: z.string(),
  narration: z.string(),
  visual: z.string(),
  note: z.string(),
  targetSec: z.number().min(0),
  beats: z.array(z.object({ keyword: z.string() })),
  facts: z.array(
    z.object({
      claim: z.string(),
      value: z.string(),
      source: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

/**
 * 白名单**剥离**而不是拒绝(zod 默认行为, 不加 .strict())。
 *
 * 这是自动保存的落点, 界面上没有保存按钮。前端多带一个字段就整个 400 的话,
 * 用户的修改会静默丢失而他毫不知情 —— 那是比"多存了个没用的字段"严重得多的
 * 失败。多余字段剥掉不落库, 保存照常成功。
 */
const BodySchema = z.object({ acts: z.array(ActSchema).min(1).max(ACT_KEYS.length) });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail(`六幕数据不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  const output = draft.output as { script?: { acts?: unknown } } | null;
  // 旧的 sections 结构拒绝保存, 而不是把它悄悄改造成六幕
  if (!output?.script || !Array.isArray(output.script.acts)) {
    return fail('这份稿子不是六幕结构, 工作区改不了', 400);
  }

  /**
   * 第一次保存时把 AI 原版快照下来, **之后永不覆盖**。
   *
   * 这是「我的版 vs AI 版」对比的基准。工具的分工是「系统给起点 → 你自己写 →
   * 系统做评估」, 没有基准就评估不了「这稿子还剩多少是 AI 的」—— 而可模仿的
   * 部分正是会被算法抹平的部分。
   *
   * 快照时机选在第一次保存而不是生成时: 生成路由有好几条(douyin/xhs/模板出片),
   * 都改一遍容易漏; 而任何一份稿子被编辑之前必然先经过这里一次。
   */
  const hasBaseline = Boolean((output as { aiBaseline?: unknown }).aiBaseline);
  const aiBaseline = hasBaseline
    ? (output as { aiBaseline: unknown }).aiBaseline
    : { acts: output.script.acts, snapshotAt: new Date().toISOString() };

  const next = {
    ...output,
    aiBaseline,
    script: { ...output.script, acts: parsed.data.acts },
  };

  await prisma.scriptDraft.update({
    where: { id },
    data: { output: next as unknown as Prisma.InputJsonObject },
  });

  return ok({ acts: parsed.data.acts, savedAt: new Date().toISOString() });
}
