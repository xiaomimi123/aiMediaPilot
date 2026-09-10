import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { loadJson } from '@/lib/settings/load';
import { PlanOnboardingEntry } from '@/components/plan/onboarding-entry';
import { PlanMain } from '@/components/plan/plan-main';
import { dayIndexFor, localDateString } from '@/lib/content-plan/day-index';
import type { PersonaProfileData } from '@/lib/persona/profile';
import type { CreatorVoiceData } from '@/lib/persona/voice';

/**
 * `/plan` 主页面 (三十八期 Task 5)。
 *
 * 无活跃规划 → 渲染问答向导(Task 4); 有活跃规划 → 查 plan + 全部 days + 用户
 * 模板列表, 算 todayIndex, 交给 PlanMain 渲主态(今日卡 + 30 天列表)。
 *
 * todayIndex 为 null 有两种情形: 规划还没到 startDate(理论上不会出现, generate
 * 时 startDate 就是当天), 或规划已经走完(今天在 startDate+totalDays 之后) ——
 * 后一种给「规划已走完, 重新规划」入口, 复用同一份向导组件, archive 旧规划的
 * 逻辑在 generate 接口里已经有(见 Task 1)。
 */
export const dynamic = 'force-dynamic';

const EMPTY_PROFILE: PersonaProfileData = {
  audience: '', targetFans: '', pillars: [], angle: '', avoid: '',
  painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '',
};

const EMPTY_VOICE: CreatorVoiceData = { origin: '', identity: '', notIdentity: '', stances: [], energy: '' };

/** 服务器本地日期 "YYYY-MM-DD"(不用 toISOString —— 那是 UTC, 会在时区边界错一天)。 */

/** startDate + dayIndex(1-based) → "YYYY-MM-DD"，与 dayIndexFor 的算法保持对称。 */
function dateForDayIndex(startDate: string, dayIndex: number): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const d = new Date(start.getTime() + (dayIndex - 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default async function PlanPage() {
  const user = await getOrCreateDefaultUser();

  const [activePlan, templates, profileResp, voiceResp] = await Promise.all([
    prisma.contentPlan.findFirst({ where: { userId: user.id, status: 'active' } }),
    prisma.videoTemplate.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, deliveryMode: true },
    }),
    loadJson<PersonaProfileData & { established: boolean }>('/api/v1/persona/profile'),
    loadJson<CreatorVoiceData & { established: boolean }>('/api/v1/voice/profile'),
  ]);

  const profile: PersonaProfileData = profileResp
    ? (({ established: _pe, ...rest }) => rest)(profileResp)
    : EMPTY_PROFILE;
  const voice: CreatorVoiceData = voiceResp
    ? (({ established: _ve, ...rest }) => rest)(voiceResp)
    : EMPTY_VOICE;

  if (!activePlan) {
    return (
      <PageShell title="规划" description="回答几个问题，AI 帮你排好 30 天内容路线。">
        <PlanOnboardingEntry templates={templates} initialProfile={profile} initialVoice={voice} />
      </PageShell>
    );
  }

  const today = localDateString();
  const todayIndex = dayIndexFor(activePlan.startDate, today, activePlan.totalDays);
  const endDate = dateForDayIndex(activePlan.startDate, activePlan.totalDays);
  const ended = todayIndex === null && today > endDate;

  if (ended) {
    return (
      <PageShell title="规划" description="这份 30 天规划已经走完了，重新规划下一个 30 天。">
        <PlanOnboardingEntry templates={templates} initialProfile={profile} initialVoice={voice} />
      </PageShell>
    );
  }

  const days = await prisma.contentPlanDay.findMany({
    where: { planId: activePlan.id },
    orderBy: { dayIndex: 'asc' },
  });

  const personaSnapshot = activePlan.personaSnapshot as unknown as {
    pillars: { name: string; description: string }[];
  };

  return (
    <PageShell title="规划" description="今天打开就有活干。">
      <PlanMain
        planId={activePlan.id}
        todayIndex={todayIndex}
        days={days.map((d) => ({
          dayIndex: d.dayIndex,
          date: dateForDayIndex(activePlan.startDate, d.dayIndex),
          pillarName: d.pillarName,
          topic: d.topic,
          angle: d.angle,
          hookDirection: d.hookDirection,
          status: d.status as 'pending' | 'scripted' | 'produced',
          scriptDraftId: d.scriptDraftId,
          videoProductionId: d.videoProductionId,
        }))}
        pillars={personaSnapshot.pillars.map((p) => ({ name: p.name }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        defaultTemplateId={activePlan.defaultTemplateId}
      />
    </PageShell>
  );
}
