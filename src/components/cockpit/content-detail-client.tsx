"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceState } from "@/lib/cockpit/use-workspace-state";
import { stageFlowFor, stageLabelFor } from "@/lib/cockpit/platform-stages";
import { STAGE_TO_TAB } from "@/lib/cockpit/stage-tab-map";
import {
  canScheduleStage,
  completedPublishingEvents,
  removeStageEvent,
  scheduleStageForDate,
  setContentStageCompletion,
  transitionContentStage,
} from "@/lib/cockpit/workflow"; // 与 Cockpit.tsx 同一个纯函数导入源
import { completeContentReview, deleteContentFromWorkspace } from "@/lib/cockpit/workspace";
import { todayISO } from "@/lib/cockpit/calculations";
import { ContentDetailView, type ContentDrawerTab } from "./content-detail";
import type { WorkStage, ContentItem, ContentStage, InsightRule } from "@/lib/cockpit/model";

export function ContentDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, setState, hydrated } = useWorkspaceState({
    onLoadError: () => {},
    onSaveError: () => {},
  });
  const item = useMemo(() => state.contents.find((c) => c.id === id) ?? null, [state.contents, id]);

  const [toast, setToast] = useState("");

  // 与 Cockpit.tsx 同款 toast 自动消失效果 — ContentDrawer 只把消息通过 notify
  // 回调传出来，本身不渲染 toast，需要挂载方自己渲染并计时清空。
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!hydrated) return <p className="muted">加载中…</p>;
  if (!item) return <div className="page"><p className="muted">没有找到这条内容，可能已被删除。</p><a href="/">返回看板</a></div>;

  const stepParam = searchParams.get("step");
  const flow = stageFlowFor(item.platform);
  const defaultStage = flow.includes(item.stage as WorkStage) ? (item.stage as WorkStage) : flow[0];
  const initialTab: ContentDrawerTab = stepParam && stepParam in STAGE_TO_TAB
    ? STAGE_TO_TAB[stepParam as WorkStage]
    : STAGE_TO_TAB[defaultStage];

  // 下面每个函数都是从 Cockpit.tsx 对应同名函数搬来的**故意保留的独立副本**
  // （不抽共享模块）——这些函数把校验/toast提示/setState 混在一起，不是纯
  // `(state, args) => state` 函数，抽共享层需要先拆分校验与状态变更两层，
  // 属于超出本计划范围的重构；Cockpit.tsx 是这些逻辑的唯一真源，出现行为分歧时
  // 以 Cockpit.tsx 为准同步过来（同 content-drawer.tsx 里 `linkCockpitContent`
  // 与旧路由逻辑重复未抽共享的先例，见该文件相关注释）。搬运时把 `setToast` 换成
  // 本文件顶部这个局部 toast state，`setSelectedId(null)`（仅 deleteContent 里有，
  // Cockpit.tsx 原 deleteContent 里）换成 `router.push('/?view=platform-' + item.platform)`。

  // 下面这批函数原本在 Cockpit.tsx 里用 `function` 声明；这里改成 const 箭头函数——
  // 唯一原因是 TS 的空值收窄不会跨越（会被提升的）嵌套 function 声明生效，`item` 上面
  // 已经判过非空，用箭头函数表达式才能让 TS 认得 `item` 在这些函数体内非 null，逻辑本身
  // 与 Cockpit.tsx 原函数体完全一致。

  const updateItem = (patch: Partial<ContentItem>) => { // 对照 Cockpit.tsx updateContent
    setState((prev) => ({ ...prev, contents: prev.contents.map((c) => c.id === item.id ? { ...c, ...patch, updatedAt: todayISO() } : c) }));
  };
  const mergeScriptField = (partial: Partial<ContentItem["script"]>) => { // 对照 Cockpit.tsx mergeScript（读取回填时刻最新 item.script，不是闭包旧值——原函数体内部逻辑照抄）
    setState((prev) => ({ ...prev, contents: prev.contents.map((c) => c.id === item.id ? { ...c, script: { ...c.script, ...partial }, updatedAt: todayISO() } : c) }));
  };
  const changeStage = (stage: ContentStage) => { // 对照 Cockpit.tsx 里 changeStage={(stage) => setState((prev) => transitionContentStage(prev, selected.id, stage, date))}，复用同一个 transitionContentStage 纯函数
    setState((prev) => transitionContentStage(prev, item.id, stage, todayISO()));
  };

  // 对照 Cockpit.tsx setStageStatus(contentId, stage, completed)
  const setStageStatus = (stage: WorkStage, completed: boolean) => {
    if (stage === "review" && completed && item.publicationStatus !== "published") {
      setToast("内容发布后才能完成复盘");
      return;
    }
    if (stage === "review" && completed && (!item.review.rating || !item.review.analysis.trim())) {
      setToast("请先到复盘页完成星级评价和复盘分析");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => {
      const withReviewStatus = stage === "review"
        ? {
            ...prev,
            contents: prev.contents.map((c) => c.id === item.id
              ? { ...c, review: { ...c.review, completedAt: completed ? completedAt : "" } }
              : c),
          }
        : prev;
      return setContentStageCompletion(withReviewStatus, item.id, stage, completed, todayISO(), completedAt);
    });
    const label = stageLabelFor(item.platform ?? "", stage);
    setToast(completed
      ? `${label}已完成，前置阶段已同步`
      : `${label}及后续阶段已恢复待完成`);
  };

  // 对照 Cockpit.tsx planStage(contentId, stage, plannedDate)
  const schedule = (stage: WorkStage, plannedDate: string) => {
    if (!plannedDate) return;
    if (!canScheduleStage(state, item.id, stage, plannedDate)) {
      setToast("排期与前后阶段冲突，请按阶段顺序安排");
      return;
    }
    setState((prev) => scheduleStageForDate(prev, item.id, stage, plannedDate));
    setToast(`${stageLabelFor(item.platform ?? "", stage)}已安排到 ${plannedDate.slice(5)}`);
  };

  // 对照 Cockpit.tsx clearStagePlan(contentId, stage)
  const unschedule = (stage: WorkStage) => {
    const event = state.stageEvents.find(
      (e) => e.contentId === item.id && e.stage === stage && !e.completedAt,
    );
    if (!event) return;
    setState((prev) => removeStageEvent(prev, event.id));
    setToast(`已取消${stageLabelFor(item.platform ?? "", stage)}排期`);
  };

  // 对照 Cockpit.tsx deleteContent(item)，setSelectedId(null) 换成路由返回平台看板
  const remove = () => {
    const confirmed = window.confirm(`确定永久删除「${item.title}」吗？\n\n它会同时从今日 Todo、档期、大目标统计和复盘中移除，且无法恢复。`);
    if (!confirmed) return;
    setState((prev) => deleteContentFromWorkspace(prev, item.id));
    router.push(`/?view=platform-${item.platform}`);
    setToast("内容已永久删除");
  };

  // 对照 Cockpit.tsx markPublished(item)
  const markPublished = () => {
    if (!item.publishedAt) {
      setToast("请先填写实际发布时间");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => {
      const publishedItem: ContentItem = {
        ...item,
        publicationStatus: "published",
        stage: "review",
        review: { ...item.review, completedAt: "" },
        updatedAt: todayISO(),
      };
      const next = {
        ...prev,
        contents: prev.contents.map((content) => content.id === item.id ? publishedItem : content),
      };
      return {
        ...next,
        stageEvents: completedPublishingEvents(next, publishedItem, completedAt),
      };
    });
    setToast("已发布，内容已进入待复盘");
  };

  // 对照 Cockpit.tsx unmarkPublished(item)
  const unmarkPublished = () => {
    setState((prev) => {
      const publishingEvents = prev.stageEvents.filter((event) => event.contentId === item.id && event.stage === "publishing");
      const latestPublishing = [...publishingEvents].sort((a, b) => b.plannedDate.localeCompare(a.plannedDate))[0];
      let stageEvents = prev.stageEvents
        .filter((event) => !(event.contentId === item.id && event.stage === "review" && !event.completedAt))
        .map((event) => event.id === latestPublishing?.id ? { ...event, plannedDate: todayISO(), completedAt: "" } : event);
      if (!latestPublishing) {
        stageEvents = [...stageEvents, {
          id: crypto.randomUUID(),
          contentId: item.id,
          stage: "publishing",
          plannedDate: todayISO(),
          rank: 0,
          completedAt: "",
        }];
      }
      return {
        ...prev,
        contents: prev.contents.map((content) => content.id === item.id ? {
          ...content,
          publicationStatus: "scheduled",
          publishedAt: "",
          stage: "publishing",
          updatedAt: todayISO(),
        } : content),
        stageEvents,
      };
    });
    setToast("已撤销发布记录");
  };

  // 对照 Cockpit.tsx saveReview(item)
  const saveReview = () => {
    if (item.publicationStatus !== "published") {
      setToast("内容发布后才能保存复盘");
      return;
    }
    if (!item.review.rating || !item.review.analysis.trim()) {
      setToast("请先完成星级评价和复盘分析");
      return;
    }
    const completedAt = new Date().toISOString();
    setState((prev) => completeContentReview(prev, item.id, todayISO(), completedAt));
    setToast(item.review.completedAt ? "复盘已更新" : "复盘已保存，内容进入已复盘");
  };

  return <>
    <ContentDetailView
    item={item}
    initialTab={initialTab}
    stageEvents={state.stageEvents}
    stageColors={state.stageColors}
    contentTypes={state.contentTypes}
    update={updateItem}
    mergeScript={(_id, partial) => mergeScriptField(partial)}
    changeStage={changeStage}
    setStageStatus={setStageStatus}
    schedule={schedule}
    unschedule={unschedule}
    remove={remove}
    markPublished={markPublished}
    unmarkPublished={unmarkPublished}
    saveReview={saveReview}
    ruleDeposited={Boolean(item.review.learnedRule.trim() && state.insightRules.some((rule) => rule.sourceContentId === item.id && rule.text === item.review.learnedRule.trim()))}
    addRule={(text) => { // 对照 Cockpit.tsx 里内联的 addRule 箭头函数逐字复制，setToast 换成本文件 toast state
      const normalized = text.trim();
      if (!normalized) return;
      setState((prev) => {
        const existing = prev.insightRules.find((rule) => rule.sourceContentId === item.id && rule.text === normalized);
        if (existing) return { ...prev, insightRules: prev.insightRules.map((rule) => rule.id === existing.id ? { ...rule, active: true } : rule) };
        const rule: InsightRule = { id: crypto.randomUUID(), text: normalized, sourceContentId: item.id, createdAt: todayISO(), active: true };
        return { ...prev, insightRules: [rule, ...prev.insightRules] };
      });
      setToast("已沉淀为内容规则");
    }}
    notify={setToast}
    />
    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </>;
}
