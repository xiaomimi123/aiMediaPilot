'use client';

import { useRouter } from 'next/navigation';
import { OnboardingWizard, type PlanTemplateOption } from './onboarding-wizard';
import type { PersonaProfileData } from '@/lib/persona/profile';
import type { CreatorVoiceData } from '@/lib/persona/voice';

/**
 * `/plan` 页面(服务端组件)与 `OnboardingWizard`(客户端组件)之间的薄封装。
 *
 * 只做一件事: 规划生成成功后 `router.refresh()`, 让服务端重新查 active 规划
 * 切到占位态。真正的「生成后直接进主视图」是 Task 5 的活 —— 这里不预先假装
 * 有一个还不存在的主视图可以跳转。
 */
export function PlanOnboardingEntry({
  templates,
  initialProfile,
  initialVoice,
}: {
  templates: PlanTemplateOption[];
  initialProfile: PersonaProfileData;
  initialVoice: CreatorVoiceData;
}) {
  const router = useRouter();
  return (
    <OnboardingWizard
      templates={templates}
      initialProfile={initialProfile}
      initialVoice={initialVoice}
      onDone={() => router.refresh()}
    />
  );
}
