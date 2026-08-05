"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PAGE_TITLES,
  QUALITY_LABELS,
  type ContentItem,
  type FollowerSnapshot,
  type GoalCycle,
  type QualityMetric,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { calculateGoalHealth, currentFollowers, formatMetric, percent } from "@/lib/cockpit/calculations";
import { getExtras } from "@/lib/cockpit/storage";
import { EditablePageTitle, ProgressBar, date } from "../shared";
import { PerformancePanel } from "../analytics/performance-panel";

function formatSyncTime(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function AccountStatusBar({ notify }: { notify: (message: string) => void }) {
  const { account } = getExtras();
  const [syncing, setSyncing] = useState(false);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/v1/douyin/auto-sync/trigger", { method: "POST" });
      const json = await res.json().catch(() => null);
      notify(json?.success ? "已提交同步任务，稍后刷新查看最新数据" : (json?.message ?? "同步入队失败"));
    } catch (err) {
      notify(err instanceof Error ? err.message : "同步入队失败");
    } finally {
      setSyncing(false);
    }
  };

  return <div className="account-status-bar">
    <span>绑定：{account?.nickname ?? "未绑定"}</span>
    <span>· 上次同步 {formatSyncTime(account?.lastAutoSyncAt ?? null)}</span>
    <button type="button" className="text-button" disabled={syncing} onClick={triggerSync}>{syncing ? "同步中…" : "立即同步"}</button>
    <Link className="text-button" href="/accounts">管理账号 →</Link>
  </div>;
}

export function GoalsView({ state, pageTitle, updateTitle, health, followers, published, updateGoal, setState, notify }: { state: WorkspaceState; pageTitle: string; updateTitle: (value: string) => void; health: ReturnType<typeof calculateGoalHealth>; followers: number; published: ContentItem[]; updateGoal: (patch: Partial<GoalCycle>) => void; setState: React.Dispatch<React.SetStateAction<WorkspaceState>>; notify: (message: string) => void }) {
  const [showConfig, setShowConfig] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(date);
  const [snapshotFollowers, setSnapshotFollowers] = useState("");
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const snapshots = [...state.followerSnapshots]
    .filter((item) => item.date >= state.goal.startDate && item.date <= state.goal.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const remainingDays = Math.max(0, Math.ceil((new Date(`${state.goal.endDate}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000) + 1);
  const remainingLabel = remainingDays > 13 ? `${Math.ceil(remainingDays / 7)} 周` : `${remainingDays} 天`;
  const tierCounts = (["A", "B", "C"] as const).map((tier) => ({
    tier,
    count: published.filter((item) => item.tier === tier).length,
  }));
  const typeCounts = Array.from(new Set([...state.contentTypes, ...published.map((item) => item.contentType)]))
    .map((contentType) => ({ contentType, count: published.filter((item) => item.contentType === contentType).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxTypeCount = Math.max(1, ...typeCounts.map((item) => item.count));

  const resetSnapshotEditor = () => {
    setEditingSnapshotId(null);
    setSnapshotDate(date);
    setSnapshotFollowers("");
    setSnapshotError("");
  };

  const saveSnapshot = () => {
    const value = Number(snapshotFollowers);
    if (!snapshotDate || !Number.isFinite(value) || value < 0) {
      setSnapshotError("请填写有效的日期和粉丝数。");
      return;
    }
    if (snapshotDate < state.goal.startDate || snapshotDate > state.goal.endDate) {
      setSnapshotError("快照日期需要在当前阶段范围内。");
      return;
    }
    if (editingSnapshotId && state.followerSnapshots.some((item) => item.id !== editingSnapshotId && item.date === snapshotDate)) {
      setSnapshotError("该日期已经有一条快照，请修改为其他日期。");
      return;
    }
    setState((prev) => {
      if (editingSnapshotId) {
        return {
          ...prev,
          followerSnapshots: prev.followerSnapshots.map((item) => item.id === editingSnapshotId
            ? { ...item, date: snapshotDate, followers: value }
            : item),
        };
      }
      const existing = prev.followerSnapshots.find((item) => item.date === snapshotDate);
      return {
        ...prev,
        followerSnapshots: existing
          ? prev.followerSnapshots.map((item) => item.date === snapshotDate ? { ...item, followers: value } : item)
          : [...prev.followerSnapshots, { id: crypto.randomUUID(), date: snapshotDate, followers: value }],
      };
    });
    resetSnapshotEditor();
  };

  const editSnapshot = (snapshot: FollowerSnapshot) => {
    setEditingSnapshotId(snapshot.id);
    setSnapshotDate(snapshot.date);
    setSnapshotFollowers(String(snapshot.followers));
    setSnapshotError("");
  };

  const archiveAndStart = () => {
    if (!window.confirm("归档后当前目标将只读保存，并创建一个新的大目标。确定继续吗？")) return;
    setState((prev) => {
      const start = new Date(`${prev.goal.endDate}T12:00:00`);
      if (Number.isNaN(start.getTime())) return prev;
      start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 3);
      end.setDate(end.getDate() - 1);
      const current = currentFollowers(prev.goal, prev.followerSnapshots);
      const nextGoal: GoalCycle = {
        id: crypto.randomUUID(),
        objective: "",
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        status: "active",
        outputTarget: 0,
        quotas: prev.contentTypes.map((contentType) => ({ contentType, target: 0 })),
        followerStart: current,
        followerTarget: current,
        qualityMetric: prev.goal.qualityMetric,
        qualityThreshold: prev.goal.qualityThreshold,
        qualityTarget: 0,
      };
      return {
        ...prev,
        goalHistory: [...(prev.goalHistory ?? []), { ...prev.goal, status: "archived" }],
        goal: nextGoal,
      };
    });
    setShowConfig(false);
  };

  return <section className="page goals-page">
    <div className="page-heading stage-goal-heading">
      <div><span className="eyebrow">大目标</span><EditablePageTitle value={pageTitle} fallback={DEFAULT_PAGE_TITLES.goals} onChange={updateTitle} /><p>{pageTitle.trim() !== state.goal.objective.trim() && state.goal.objective.trim() ? `目标方向：${state.goal.objective} · ` : ""}{state.goal.startDate} — {state.goal.endDate} · 指标修改统一放在配置中。</p></div>
      <button className="primary-button" onClick={() => setShowConfig(true)}>配置目标指标</button>
    </div>

    <section className="panel goal-core-panel">
      <header><div><span className="eyebrow">CORE METRICS</span><h2>核心指标</h2></div><span>数据随发布记录与粉丝快照自动更新</span></header>
      <div className="goal-core-grid">
        <article><div><span>剩余时间</span><strong>{remainingLabel}</strong><small>时间已过 {percent(health.timeProgress)}</small></div><div className="goal-timeline"><ProgressBar value={health.timeProgress} tone="ink" /><footer><span>{state.goal.startDate.slice(5)}</span><span>{state.goal.endDate.slice(5)}</span></footer></div></article>
        <article><div><span>当前粉丝 / 目标粉丝</span><strong>{formatMetric(followers)}<small> / {formatMetric(state.goal.followerTarget)}</small></strong><small>还差 {formatMetric(health.followerRemaining)}</small></div><ProgressBar value={health.followerProgress} tone="olive" /></article>
        <article><div><span>已发布 / 计划发布</span><strong>{published.length}<small> / {state.goal.outputTarget}</small></strong><small>还需发布 {health.outputRemaining} 条</small></div><ProgressBar value={health.outputProgress} /></article>
      </div>
    </section>

    <section className="panel follower-analytics-panel">
      <header><div><span className="eyebrow">FOLLOWER GROWTH</span><h2>账号粉丝趋势</h2><p>通过快照记录真实增长过程；点击右侧记录可以修改原始数据。</p><AccountStatusBar notify={notify} /></div><div className="snapshot-entry-wrap">{editingSnapshotId ? <span className="snapshot-editing-label">正在修改 {snapshotDate.slice(5)}</span> : null}<div className="snapshot-entry"><label><span>日期</span><input type="date" min={state.goal.startDate} max={state.goal.endDate} value={snapshotDate} onChange={(event) => { setSnapshotDate(event.target.value); setSnapshotError(""); }} /></label><label><span>粉丝数</span><input type="number" min="0" value={snapshotFollowers} onChange={(event) => { setSnapshotFollowers(event.target.value); setSnapshotError(""); }} placeholder={String(followers)} /></label><button className="secondary-button" disabled={!snapshotFollowers} onClick={saveSnapshot}>{editingSnapshotId ? "保存修改" : "录入快照"}</button>{editingSnapshotId ? <button className="text-button snapshot-cancel-button" onClick={resetSnapshotEditor}>取消</button> : null}</div>{snapshotError ? <p className="snapshot-error">{snapshotError}</p> : null}</div></header>
      <div className="follower-analytics-body">
        <FollowerTrendChart snapshots={snapshots} startDate={state.goal.startDate} endDate={state.goal.endDate} startFollowers={state.goal.followerStart} targetFollowers={state.goal.followerTarget} />
        <aside><span>快照记录（折线图原始数据）</span><strong>{snapshots.length}</strong><small>次更新</small><div>{[...snapshots].reverse().map((item) => <button key={item.id} className={editingSnapshotId === item.id ? "snapshot-record active" : "snapshot-record"} onClick={() => editSnapshot(item)} aria-label={`修改 ${item.date} 的粉丝快照`}><span>{item.date.slice(5)}</span><strong>{formatMetric(item.followers)}</strong><em>编辑</em></button>)}</div></aside>
      </div>
    </section>

    <PerformancePanel />

    <section className="panel content-analytics-panel">
      <header><div><span className="eyebrow">PUBLISHED CONTENT</span><h2>内容指标</h2><p>只统计当前阶段时间范围内已经发布的内容。</p></div><strong>{published.length}<small> 条已发布</small></strong></header>
      <div className="content-analytics-grid">
        <div><h3>按内容档位</h3><div className="goal-tier-grid">{tierCounts.map(({ tier, count }) => <article key={tier} className={`tier-${tier.toLowerCase()}`}><span>{tier}档</span><strong>{count}</strong><small>{published.length ? percent(count / published.length) : "0%"}</small></article>)}</div></div>
        <div><h3>按内容类型</h3>{typeCounts.length ? <div className="goal-type-list">{typeCounts.map((item) => <div key={item.contentType}><span>{item.contentType}</span><div><i style={{ width: percent(item.count / maxTypeCount) }} /></div><strong>{item.count}</strong></div>)}</div> : <p className="goal-empty-copy">发布内容后，这里会自动生成类型分布。</p>}</div>
      </div>
    </section>

    {showConfig ? <GoalSettingsModal goal={state.goal} goalHistory={state.goalHistory} contentTypes={state.contentTypes} close={() => setShowConfig(false)} save={(goal) => { updateGoal(goal); setShowConfig(false); }} archive={archiveAndStart} /> : null}
  </section>;
}

function FollowerTrendChart({ snapshots, startDate, endDate, startFollowers, targetFollowers }: { snapshots: FollowerSnapshot[]; startDate: string; endDate: string; startFollowers: number; targetFollowers: number }) {
  const startTime = new Date(`${startDate}T12:00:00`).getTime();
  const endTime = new Date(`${endDate}T12:00:00`).getTime();
  const totalTime = Math.max(1, endTime - startTime);
  const data = snapshots.some((item) => item.date === startDate)
    ? snapshots
    : [{ id: "goal-start", date: startDate, followers: startFollowers }, ...snapshots];
  const values = [...data.map((item) => item.followers), targetFollowers];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values, minValue + 1);
  const padding = Math.max(1, (maxValue - minValue) * .08);
  const chartMin = Math.max(0, minValue - padding);
  const chartMax = maxValue + padding;
  const xFor = (value: string) => 4 + Math.max(0, Math.min(1, (new Date(`${value}T12:00:00`).getTime() - startTime) / totalTime)) * 92;
  const yFor = (value: number) => 92 - ((value - chartMin) / Math.max(1, chartMax - chartMin)) * 82;
  const points = data.map((item) => `${xFor(item.date)},${yFor(item.followers)}`).join(" ");
  const targetY = yFor(targetFollowers);

  return <div className="follower-chart">
    <div className="follower-chart-head"><span>粉丝数</span><div><i />实际增长 <em />目标</div></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`粉丝从 ${formatMetric(startFollowers)} 增长到 ${formatMetric(data.at(-1)?.followers ?? startFollowers)}，目标 ${formatMetric(targetFollowers)}`}>
      <title>粉丝增长折线图</title>
      {[20, 44, 68, 92].map((y) => <line key={y} x1="4" x2="96" y1={y} y2={y} className="chart-grid-line" vectorEffect="non-scaling-stroke" />)}
      <line x1="4" x2="96" y1={targetY} y2={targetY} className="chart-target-line" vectorEffect="non-scaling-stroke" />
      <polyline points={points} className="chart-growth-line" vectorEffect="non-scaling-stroke" />
      {data.map((item) => <circle key={item.id} cx={xFor(item.date)} cy={yFor(item.followers)} r="1.15" vectorEffect="non-scaling-stroke"><title>{item.date} · {formatMetric(item.followers)} 粉丝</title></circle>)}
    </svg>
    <footer><span>{startDate.slice(5)}</span><strong>当前 {formatMetric(data.at(-1)?.followers ?? startFollowers)}</strong><span>{endDate.slice(5)}</span></footer>
  </div>;
}

function GoalSettingsModal({ goal, goalHistory, contentTypes, close, save, archive }: { goal: GoalCycle; goalHistory: GoalCycle[]; contentTypes: string[]; close: () => void; save: (goal: GoalCycle) => void; archive: () => void }) {
  const [draft, setDraft] = useState<GoalCycle>(() => ({
    ...goal,
    quotas: [
      ...contentTypes.map((contentType) => goal.quotas.find((item) => item.contentType === contentType) ?? { contentType, target: 0 }),
      ...goal.quotas.filter((item) => item.contentType === "其他"),
    ],
  }));
  const assignedTotal = draft.quotas.filter((item) => item.contentType !== "其他").reduce((sum, item) => sum + Math.max(0, item.target || 0), 0);
  const unallocated = Math.max(0, draft.outputTarget - assignedTotal);
  const invalid = assignedTotal > draft.outputTarget || !draft.startDate || !draft.endDate || draft.endDate < draft.startDate;
  const updateQuota = (contentType: string, target: number) => setDraft((prev) => ({
    ...prev,
    quotas: prev.quotas.map((item) => item.contentType === contentType ? { ...item, target } : item),
  }));

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className="goal-config-modal" role="dialog" aria-modal="true" aria-labelledby="goal-config-title">
      <header><div><span className="eyebrow">GOAL SETTINGS</span><h2 id="goal-config-title">配置大目标</h2><p>保存后，外部总览与发布统计会自动重新计算。</p></div><button className="close-button" onClick={close} aria-label="关闭目标配置">×</button></header>
      <div className="goal-config-body">
        <section><h3>阶段方向与时间</h3><label className="field full"><span>阶段大目标</span><textarea value={draft.objective} onChange={(event) => setDraft((prev) => ({ ...prev, objective: event.target.value }))} placeholder="这一阶段，希望账号进入什么状态？" /></label><div className="form-grid"><label className="field"><span>开始日期</span><input type="date" value={draft.startDate} onChange={(event) => setDraft((prev) => ({ ...prev, startDate: event.target.value }))} /></label><label className="field"><span>结束日期</span><input type="date" value={draft.endDate} onChange={(event) => setDraft((prev) => ({ ...prev, endDate: event.target.value }))} /></label></div></section>
        <section><h3>发布目标</h3><label className="field goal-config-total"><span>计划发布总数</span><input type="number" min="0" value={draft.outputTarget} onChange={(event) => setDraft((prev) => ({ ...prev, outputTarget: Number(event.target.value) }))} /></label><div className="goal-config-quota">{draft.quotas.filter((item) => item.contentType !== "其他").map((quota) => <label key={quota.contentType}><span>{quota.contentType}</span><input type="number" min="0" value={quota.target} onChange={(event) => updateQuota(quota.contentType, Number(event.target.value))} /></label>)}</div><p className={assignedTotal > draft.outputTarget ? "validation-note" : "goal-config-hint"}>{assignedTotal > draft.outputTarget ? `类型配额已超过总目标 ${assignedTotal - draft.outputTarget} 条。` : `尚未分配的 ${unallocated} 条会自动归入“其他”。`}</p></section>
        <section><h3>账号粉丝目标</h3><div className="form-grid"><label className="field"><span>阶段开始粉丝</span><input type="number" min="0" value={draft.followerStart} onChange={(event) => setDraft((prev) => ({ ...prev, followerStart: Number(event.target.value) }))} /></label><label className="field"><span>阶段目标粉丝</span><input type="number" min="0" value={draft.followerTarget} onChange={(event) => setDraft((prev) => ({ ...prev, followerTarget: Number(event.target.value) }))} /></label></div></section>
        <details className="goal-quality-settings"><summary>质量门槛（可选）</summary><div className="quality-form"><label><span>主要指标</span><select value={draft.qualityMetric} onChange={(event) => setDraft((prev) => ({ ...prev, qualityMetric: event.target.value as QualityMetric }))}>{Object.entries(QUALITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>单条门槛{["likeRate", "saveRate", "commentRate"].includes(draft.qualityMetric) ? "（%）" : ""}</span><input type="number" min="0" step="0.1" value={draft.qualityThreshold} onChange={(event) => setDraft((prev) => ({ ...prev, qualityThreshold: Number(event.target.value) }))} /></label><label><span>阶段达标条数</span><input type="number" min="0" value={draft.qualityTarget} onChange={(event) => setDraft((prev) => ({ ...prev, qualityTarget: Number(event.target.value) }))} /></label></div></details>
        {goalHistory.length ? <details className="goal-history-settings"><summary>历史阶段（{goalHistory.length}）</summary>{[...goalHistory].reverse().map((item) => <article key={item.id}><div><strong>{item.objective || "未命名阶段目标"}</strong><small>{item.startDate} — {item.endDate}</small></div><span>{item.outputTarget} 条发布目标</span><span>{formatMetric(item.followerTarget)} 粉丝目标</span></article>)}</details> : null}
      </div>
      <footer><button className="text-button" onClick={archive}>归档并开始下一阶段</button><div><button className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={invalid} onClick={() => save(draft)}>保存配置</button></div></footer>
    </section>
  </div>;
}
