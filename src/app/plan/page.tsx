import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { loadJson } from '@/lib/settings/load';
import { PlanOnboardingEntry } from '@/components/plan/onboarding-entry';
import type { PersonaProfileData } from '@/lib/persona/profile';
import type { CreatorVoiceData } from '@/lib/persona/voice';

/**
 * `/plan` 最小占位页 (三十八期 Task 4)。
 *
 * 无活跃规划 → 渲染问答向导(本任务交付); 有活跃规划 → 先渲一行占位,
 * 主视图是 Task 5 的活, 这里不抢它的活。
 */
export const dynamic = 'force-dynamic';

const EMPTY_PROFILE: PersonaProfileData = {
  audience: '', targetFans: '', pillars: [], angle: '', avoid: '',
  painPoints: [], offerings: [], productLogic: '', marketInsight: null, systemSummary: '',
};

const EMPTY_VOICE: CreatorVoiceData = { origin: '', identity: '', notIdentity: '', stances: [], energy: '' };

export default async function PlanPage() {
  const user = await getOrCreateDefaultUser();

  const [activePlan, templates, profileResp, voiceResp] = await Promise.all([
    prisma.contentPlan.findFirst({ where: { userId: user.id, status: 'active' }, select: { id: true } }),
    prisma.videoTemplate.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, deliveryMode: true },
    }),
    loadJson<PersonaProfileData & { established: boolean }>('/api/v1/persona/profile'),
    loadJson<CreatorVoiceData & { established: boolean }>('/api/v1/voice/profile'),
  ]);

  if (activePlan) {
    return (
      <PageShell title="规划" description="AI 排好 30 天选题，今天打开就有活干。">
        <p className="text-sm text-muted-foreground">规划已生成，主视图在下一任务上线。</p>
      </PageShell>
    );
  }

  const profile: PersonaProfileData = profileResp
    ? (({ established: _pe, ...rest }) => rest)(profileResp)
    : EMPTY_PROFILE;
  const voice: CreatorVoiceData = voiceResp
    ? (({ established: _ve, ...rest }) => rest)(voiceResp)
    : EMPTY_VOICE;

  return (
    <PageShell title="规划" description="回答几个问题，AI 帮你排好 30 天内容路线。">
      <PlanOnboardingEntry templates={templates} initialProfile={profile} initialVoice={voice} />
    </PageShell>
  );
}
