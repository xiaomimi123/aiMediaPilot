import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_CREATOR_PROFILE, DEFAULT_DESIGN_STYLE, DEFAULT_NAVIGATION_ORDER,
  DEFAULT_PAGE_TITLES, DEFAULT_SCHEDULE_OBJECT_TYPES, DEFAULT_STAGE_COLORS,
  DEFAULT_CONTENT_TYPES, type WorkspaceState, type GoalCycle,
} from './model';

const EPOCH = '1970-01-01T00:00:00.000Z';

function defaultGoal(): GoalCycle {
  return {
    id: 'goal-default', objective: '', startDate: '', endDate: '', status: 'active',
    outputTarget: 0, quotas: [], followerStart: 0, followerTarget: 0,
    qualityMetric: 'views', qualityThreshold: 0, qualityTarget: 0,
  };
}

export async function loadWorkspaceFromDb(userId: string) {
  const [prefs, contents, inspirations, stageEvents, reviewDays, liveSessions,
    scheduleObjectTypes, scheduleObjects, goals, insightRules, accountMetrics] =
    await Promise.all([
      prisma.cockpitPrefs.findUnique({ where: { userId } }),
      prisma.cockpitContent.findMany({ where: { userId } }),
      prisma.cockpitInspiration.findMany({ where: { userId } }),
      prisma.cockpitStageEvent.findMany({ where: { userId } }),
      prisma.cockpitReviewDay.findMany({ where: { userId } }),
      prisma.cockpitLiveSession.findMany({ where: { userId } }),
      prisma.cockpitScheduleObjectType.findMany({ where: { userId } }),
      prisma.cockpitScheduleObject.findMany({ where: { userId } }),
      prisma.cockpitGoalCycle.findMany({ where: { userId } }),
      prisma.cockpitInsightRule.findMany({ where: { userId } }),
      prisma.accountMetric.findMany({
        where: { account: { userId } }, orderBy: { date: 'desc' }, take: 400,
        select: { id: true, date: true, followerCount: true },
      }).then((rows) => rows.reverse()),
    ]);
  const active = goals.find((g) => g.status === 'active');
  const state: WorkspaceState = {
    schemaVersion: 16,
    designStyle: (prefs?.designStyle ?? DEFAULT_DESIGN_STYLE) as WorkspaceState['designStyle'],
    navigationOrder: (prefs?.navigationOrder as WorkspaceState['navigationOrder']) ?? DEFAULT_NAVIGATION_ORDER,
    profile: (prefs?.profile as unknown as WorkspaceState['profile']) ?? DEFAULT_CREATOR_PROFILE,
    pageTitles: (prefs?.pageTitles as WorkspaceState['pageTitles']) ?? DEFAULT_PAGE_TITLES,
    stageColors: (prefs?.stageColors as WorkspaceState['stageColors']) ?? DEFAULT_STAGE_COLORS,
    contentTypes: (prefs?.contentTypes as string[]) ?? DEFAULT_CONTENT_TYPES,
    setupComplete: prefs?.setupComplete ?? false,
    lastBackupAt: prefs?.lastBackupAt ?? '',
    inspirationCards: inspirations.map(({ userId: _u, ...rest }) => ({
      ...rest, convertedContentIds: rest.convertedContentIds as string[],
    })),
    // 六期 T2: scriptDraftId 只读下发 (供抽屉重开懒加载拉回改稿 UI)——不从 contents
    // 剥掉了；PUT /api/v1/cockpit/workspace 的 saveWorkspaceToDb 仍然不接收这个字段
    // (data 字段列表里没有它), 服务端始终是唯一写入方。analysisId 暂不需要前端消费,
    // 继续剥掉。
    contents: contents.map(({ userId: _u, analysisId: _a, ...rest }) => ({
      ...rest, tags: rest.tags as string[],
      // 三期 IA 演化: platform 字段 — 防御性回退, 兼容列刚上线前写入 / 未过 db:push 默认值的存量行
      platform: rest.platform ?? 'douyin',
      topic: rest.topic as any, script: rest.script as any,
      metrics: rest.metrics as any, review: rest.review as any,
    })) as WorkspaceState['contents'],
    stageEvents: stageEvents.map(({ userId: _u, ...rest }) => rest) as WorkspaceState['stageEvents'],
    reviewDays: reviewDays.map(({ userId: _u, ...rest }) => rest),
    liveSessions: liveSessions.map(({ userId: _u, ...rest }) => rest),
    scheduleObjectTypes: scheduleObjectTypes.length
      ? scheduleObjectTypes.map(({ userId: _u, ...rest }) => rest) as WorkspaceState['scheduleObjectTypes']
      : DEFAULT_SCHEDULE_OBJECT_TYPES,
    scheduleObjects: scheduleObjects.map(({ userId: _u, ...rest }) => rest),
    goal: active ? toGoal(active) : defaultGoal(),
    goalHistory: goals.filter((g) => g.status === 'archived').map(toGoal),
    followerSnapshots: accountMetrics.map((m) => ({
      id: m.id, date: m.date.toISOString().slice(0, 10), followers: m.followerCount,
    })),
    insightRules: insightRules.map(({ userId: _u, ...rest }) => rest),
  };
  return { state, rev: prefs?.updatedAt.toISOString() ?? EPOCH };
}

function toGoal(g: { userId?: string } & Record<string, unknown>): GoalCycle {
  const { userId: _u, ...rest } = g;
  return { ...(rest as unknown as GoalCycle), quotas: (g.quotas ?? []) as GoalCycle['quotas'] };
}

type SaveResult = { ok: true; rev: string } | { ok: false; conflict: true };

/**
 * 全量同步 userId 的整棵 WorkspaceState 到 DB — 每张实体表都是
 * "以客户端传来的 id 集合为准" 的 delete-then-upsert, 在一个事务内完成。
 *
 * 冲突检测 (compare-and-set): 事务内第一条语句就是
 * `updateMany({ where: { userId, updatedAt: baseRev }, ... })` — 这是一条原子的
 * UPDATE ... WHERE, 数据库会对匹配行加锁; 两个并发事务用同一个 baseRev 竞争时,
 * 后提交的那个在它执行到这条 updateMany 时, 行的 updatedAt 已经被前者改变,
 * WHERE 不再匹配 → count === 0, 从而被判定为冲突、整体回滚, 不会出现
 * "先 findUnique 判断通过, 再各自 delete-then-upsert" 的 check-then-write 竞态
 * (两者都通过检查后, 后写入的一方会用自己的全量状态覆盖/抹掉先写入的一方的行)。
 *
 * count === 0 时需要区分两种情况:
 *   - CockpitPrefs 行已存在 (别处已更新过) → 真冲突, 拒绝
 *   - CockpitPrefs 行还不存在 (onboarding 后的首次保存) → updateMany 本来就是
 *     no-op, 不代表冲突, 继续走下面的写入 (最后 upsert 会 create 这一行)
 */
export async function saveWorkspaceToDb(
  userId: string,
  state: WorkspaceState,
  baseRev: string,
): Promise<SaveResult> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.cockpitPrefs.updateMany({
      where: { userId, updatedAt: new Date(baseRev) },
      data: { setupComplete: state.setupComplete },
    });
    if (claimed.count === 0) {
      const existingPrefs = await tx.cockpitPrefs.findUnique({ where: { userId } });
      if (existingPrefs) {
        return { ok: false, conflict: true } as const;
      }
      // 首次保存: 没有 prefs 行, 上面的 updateMany 天然是 no-op, 继续往下走。
    }

    // ---- inspirationCards → CockpitInspiration ----
    const inspirationIds = state.inspirationCards.map((c) => c.id);
    await tx.cockpitInspiration.deleteMany({ where: { userId, id: { notIn: inspirationIds } } });
    for (const card of state.inspirationCards) {
      const data = {
        userId,
        text: card.text,
        convertedContentIds: card.convertedContentIds,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };
      await tx.cockpitInspiration.upsert({
        where: { id: card.id },
        update: data,
        create: { id: card.id, ...data },
      });
    }

    // ---- contents → CockpitContent (scriptDraftId / analysisId 是服务端字段, 不写) ----
    const contentIds = state.contents.map((c) => c.id);
    await tx.cockpitContent.deleteMany({ where: { userId, id: { notIn: contentIds } } });
    for (const item of state.contents) {
      const data = {
        userId,
        title: item.title,
        idea: item.idea,
        contentType: item.contentType,
        tier: item.tier,
        // 三期 IA 演化: platform 字段
        platform: item.platform,
        stage: item.stage,
        publicationStatus: item.publicationStatus,
        priority: item.priority,
        tags: item.tags,
        publishedAt: item.publishedAt,
        xhsLink: item.xhsLink,
        coverCopy: item.coverCopy,
        publishCopy: item.publishCopy,
        topic: item.topic as object,
        script: item.script as object,
        recordingNotes: item.recordingNotes,
        editingNotes: item.editingNotes,
        metrics: item.metrics as object,
        review: item.review as object,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
      await tx.cockpitContent.upsert({
        where: { id: item.id },
        update: data,
        create: { id: item.id, ...data },
      });
    }

    // ---- stageEvents → CockpitStageEvent ----
    const stageEventIds = state.stageEvents.map((e) => e.id);
    await tx.cockpitStageEvent.deleteMany({ where: { userId, id: { notIn: stageEventIds } } });
    for (const event of state.stageEvents) {
      const data = {
        userId,
        contentId: event.contentId,
        stage: event.stage,
        plannedDate: event.plannedDate,
        rank: event.rank,
        completedAt: event.completedAt,
      };
      await tx.cockpitStageEvent.upsert({
        where: { id: event.id },
        update: data,
        create: { id: event.id, ...data },
      });
    }

    // ---- reviewDays → CockpitReviewDay ----
    const reviewDayIds = state.reviewDays.map((d) => d.id);
    await tx.cockpitReviewDay.deleteMany({ where: { userId, id: { notIn: reviewDayIds } } });
    for (const day of state.reviewDays) {
      const data = {
        userId,
        plannedDate: day.plannedDate,
        note: day.note,
        createdAt: day.createdAt,
      };
      await tx.cockpitReviewDay.upsert({
        where: { id: day.id },
        update: data,
        create: { id: day.id, ...data },
      });
    }

    // ---- liveSessions → CockpitLiveSession ----
    const liveSessionIds = state.liveSessions.map((s) => s.id);
    await tx.cockpitLiveSession.deleteMany({ where: { userId, id: { notIn: liveSessionIds } } });
    for (const session of state.liveSessions) {
      const data = {
        userId,
        title: session.title,
        plannedDate: session.plannedDate,
        startTime: session.startTime,
        endTime: session.endTime,
        platform: session.platform,
        content: session.content,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
      await tx.cockpitLiveSession.upsert({
        where: { id: session.id },
        update: data,
        create: { id: session.id, ...data },
      });
    }

    // ---- scheduleObjectTypes → CockpitScheduleObjectType ----
    const scheduleObjectTypeIds = state.scheduleObjectTypes.map((t) => t.id);
    await tx.cockpitScheduleObjectType.deleteMany({
      where: { userId, id: { notIn: scheduleObjectTypeIds } },
    });
    for (const type of state.scheduleObjectTypes) {
      const data = {
        userId,
        kind: type.kind,
        name: type.name,
        description: type.description,
        color: type.color,
        archived: type.archived,
        createdAt: type.createdAt,
      };
      await tx.cockpitScheduleObjectType.upsert({
        where: { id: type.id },
        update: data,
        create: { id: type.id, ...data },
      });
    }

    // ---- scheduleObjects → CockpitScheduleObject ----
    const scheduleObjectIds = state.scheduleObjects.map((o) => o.id);
    await tx.cockpitScheduleObject.deleteMany({ where: { userId, id: { notIn: scheduleObjectIds } } });
    for (const obj of state.scheduleObjects) {
      const data = {
        userId,
        typeId: obj.typeId,
        title: obj.title,
        plannedDate: obj.plannedDate,
        startTime: obj.startTime,
        endTime: obj.endTime,
        details: obj.details,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      };
      await tx.cockpitScheduleObject.upsert({
        where: { id: obj.id },
        update: data,
        create: { id: obj.id, ...data },
      });
    }

    // ---- goal + goalHistory → CockpitGoalCycle ----
    const goalRows = [state.goal, ...state.goalHistory];
    const goalIds = goalRows.map((g) => g.id);
    await tx.cockpitGoalCycle.deleteMany({ where: { userId, id: { notIn: goalIds } } });
    for (const goal of goalRows) {
      const data = {
        userId,
        objective: goal.objective,
        startDate: goal.startDate,
        endDate: goal.endDate,
        status: goal.status,
        outputTarget: goal.outputTarget,
        quotas: goal.quotas as object,
        followerStart: goal.followerStart,
        followerTarget: goal.followerTarget,
        qualityMetric: goal.qualityMetric,
        qualityThreshold: goal.qualityThreshold,
        qualityTarget: goal.qualityTarget,
      };
      await tx.cockpitGoalCycle.upsert({
        where: { id: goal.id },
        update: data,
        create: { id: goal.id, ...data },
      });
    }

    // ---- insightRules → CockpitInsightRule ----
    const insightRuleIds = state.insightRules.map((r) => r.id);
    await tx.cockpitInsightRule.deleteMany({ where: { userId, id: { notIn: insightRuleIds } } });
    for (const rule of state.insightRules) {
      const data = {
        userId,
        text: rule.text,
        sourceContentId: rule.sourceContentId,
        active: rule.active,
        createdAt: rule.createdAt,
      };
      await tx.cockpitInsightRule.upsert({
        where: { id: rule.id },
        update: data,
        create: { id: rule.id, ...data },
      });
    }

    // followerSnapshots: 派生数据, 从不写回

    // ---- prefs → CockpitPrefs ----
    const prefsData = {
      designStyle: state.designStyle,
      navigationOrder: state.navigationOrder as object,
      profile: state.profile as object,
      pageTitles: state.pageTitles as object,
      stageColors: state.stageColors as object,
      contentTypes: state.contentTypes,
      setupComplete: state.setupComplete,
      lastBackupAt: state.lastBackupAt,
    };
    const newPrefs = await tx.cockpitPrefs.upsert({
      where: { userId },
      update: prefsData,
      create: { userId, ...prefsData },
    });

    return { ok: true, rev: newPrefs.updatedAt.toISOString() } as const;
  });
}

/**
 * 集成钩子 (picked 定稿 / auto-sync 回填 / retro 复盘回填) 直接写 CockpitContent /
 * CockpitStageEvent, 不经过 saveWorkspaceToDb — 但客户端标签页手里的 rev 只认
 * CockpitPrefs.updatedAt。若钩子写完不触碰 prefs, 打开的标签页会一直以为自己的
 * rev 仍然新鲜, 下一次整页保存 (全量 delete-then-upsert) 就会用旧状态把钩子刚写
 * 的内容覆盖掉 — 静默丢钩子写入。
 *
 * 因此每个钩子在自己的 cockpit 写入成功后调用本函数"敲一下" prefs.updatedAt,
 * 让在线标签页的 rev 失效、下次保存走 409 → 客户端重新加载最新状态。
 * 只碰 updatedAt, 不碰任何业务字段 (故用 $executeRaw 而不是 update/updateMany
 * data:{} — Prisma 要求 data 至少一个字段, 而业务字段真值我们并不想改)。
 * 用户还没有 CockpitPrefs 行 (没做过 onboarding) 时是 no-op, 符合钩子 fail-soft
 * 语义, 调用方应放在自己已有的 try/catch 里。
 *
 * 可选 `client` 参数: 默认用顶层 `prisma`, 但当调用方本身就是"cockpit 写入是主流程"
 * 的路由 (例如 POST /api/v1/cockpit/inspirations) 时, 传入 `tx` 把这次 bump 纳入
 * 同一个事务 — 此时 bump 失败必须回滚主写入, 而不是 fail-soft 吞掉 (否则会重新
 * 打开 I1 的"数据已落库但 rev 未失效"覆盖窗口)。
 */
export async function bumpCockpitRev(
  userId: string,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<void> {
  await client.$executeRaw`UPDATE "CockpitPrefs" SET "updatedAt" = NOW() WHERE "userId" = ${userId}`;
}
