'use client';

import { useMemo, useState } from 'react';
import { TodayCard, type TodayCardDay, type TodayCardTemplateOption } from './today-card';
import { PlanList, type PlanListDay } from './plan-list';

export interface PlanMainDay extends PlanListDay {
  angle: string;
  hookDirection: string;
  scriptDraftId: string | null;
  videoProductionId: string | null;
}

export interface PlanMainProps {
  planId: string;
  todayIndex: number | null;
  days: PlanMainDay[];
  pillars: { name: string }[];
  templates: TodayCardTemplateOption[];
  defaultTemplateId: string | null;
}

/**
 * `/plan` 主态(三十八期 Task 5) —— 今日卡 + 30 天列表。
 *
 * 今日卡状态变化只在本组件内的 `days` 状态里就地更新对应 dayIndex 那一条,
 * 不整页 `router.refresh()` —— 那样会把用户刚拿到手的「脚本已就绪」瞬间闪掉
 * 重新走一次服务端渲染, 体验上等于白等了一次网络往返。
 *
 * 规划已走完(todayIndex 为 null 且今天在结束后)的入口不在这里 —— 那种情形
 * 页面层直接换渲向导组件(见 `src/app/plan/page.tsx`), 本组件不处理「重新规划」。
 */
export function PlanMain({
  planId,
  todayIndex,
  days: initialDays,
  pillars,
  templates,
  defaultTemplateId,
}: PlanMainProps) {
  const [days, setDays] = useState(initialDays);

  const todayDay = useMemo(
    () => (todayIndex !== null ? days.find((d) => d.dayIndex === todayIndex) ?? null : null),
    [days, todayIndex],
  );

  function handleTodayUpdated(updated: TodayCardDay) {
    if (todayIndex === null) return;
    setDays((prev) =>
      prev.map((d) =>
        d.dayIndex === todayIndex
          ? {
              ...d,
              topic: updated.topic,
              angle: updated.angle,
              hookDirection: updated.hookDirection,
              status: updated.status,
              scriptDraftId: updated.scriptDraftId,
              videoProductionId: updated.videoProductionId,
            }
          : d,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {todayDay ? (
        <TodayCard
          planId={planId}
          dayIndex={todayIndex as number}
          day={{
            topic: todayDay.topic,
            angle: todayDay.angle,
            hookDirection: todayDay.hookDirection,
            status: todayDay.status,
            scriptDraftId: todayDay.scriptDraftId,
            videoProductionId: todayDay.videoProductionId,
          }}
          templates={templates}
          defaultTemplateId={defaultTemplateId}
          onDayUpdated={handleTodayUpdated}
        />
      ) : null}
      <PlanList days={days} todayIndex={todayIndex} pillars={pillars} />
    </div>
  );
}
