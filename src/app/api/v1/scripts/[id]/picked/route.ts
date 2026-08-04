import { randomUUID } from 'crypto';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { todayISO } from '@/lib/cockpit/calculations';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';
import type { PickedState } from '@/lib/script-picked/types';

function parsePicked(input: unknown): PickedState | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const reviewed: Record<string, boolean> = {};
  if (o.reviewed && typeof o.reviewed === 'object') {
    for (const [k, v] of Object.entries(o.reviewed as Record<string, unknown>)) {
      if (typeof v === 'boolean') reviewed[k] = v;
    }
  }
  return {
    titleIdx: typeof o.titleIdx === 'number' && Number.isInteger(o.titleIdx) ? o.titleIdx : undefined,
    hookIdx: typeof o.hookIdx === 'number' && Number.isInteger(o.hookIdx) ? o.hookIdx : undefined,
    reviewed,
  };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const picked = parsePicked(body);
  if (!picked) return fail('picked 数据非法', 400);

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  try {
    await prisma.scriptDraft.update({
      where: { id },
      data: { picked: picked as any },
    });

    // 定稿(picked)推进关联 cockpit content 阶段 — 仅当当前 stage 为 'script' 时,
    // 语义同 setContentStageCompletion；失败不阻塞定稿本身
    try {
      const content = await prisma.cockpitContent.findFirst({
        where: { scriptDraftId: id, userId: user.id },
        select: { id: true, stage: true },
      });
      if (content && content.stage === 'script') {
        const today = todayISO();
        await prisma.cockpitContent.update({
          where: { id: content.id },
          data: { stage: 'recording', updatedAt: today },
        });
        await prisma.cockpitStageEvent.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            contentId: content.id,
            stage: 'script',
            plannedDate: today,
            rank: 0,
            completedAt: new Date().toISOString(),
          },
        });
        // 钩子直接写了 CockpitContent/CockpitStageEvent, 不经过 saveWorkspaceToDb —
        // 敲一下 prefs.updatedAt, 让打开的标签页 rev 失效, 下次整页保存走 409 重新加载,
        // 而不是静默用旧状态覆盖掉这里刚推进的 stage。
        await bumpCockpitRev(user.id);
      }
    } catch (e) {
      console.warn('[PUT scripts/picked] cockpit stage advance failed', e);
    }

    return ok({ saved: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PUT scripts/picked]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}
