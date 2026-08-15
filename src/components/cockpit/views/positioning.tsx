"use client";

import { useEffect, useState } from "react";
import { PersonaCard } from "../settings-cards/persona-card";
import { StyleProfileCard } from "../settings-cards/style-profile-card";

/**
 * 「账号定位」视图 — 十一期 T2, spec `docs/superpowers/specs/2026-08-15-positioning-view-design.md`。
 *
 * 三段纵向结构：
 *   1. 顶部体系报告——本视图**自行** `GET /api/v1/persona/profile` 取 `systemSummary`
 *      展示 + 导出，与下方 `PersonaCard` 内部各自取数会有一次重复请求，接受（YAGNI，
 *      不为省一次 GET 引入跨组件状态提升；见 task-2-brief.md 裁决）。
 *   2. `<PersonaCard />`（十期原样迁移，props 不变，内部起草/保存互斥、confirm 前置等
 *      逻辑一律不动——本视图不重写卡片本体，只换挂载位置，见卡片顶部注释）。
 *   3. `<StyleProfileCard />`（同上）。
 *
 * 与 `RadarView` 一样是自取数视图，但比它更轻：本视图不写任何 cockpit 事务，不消费/不写
 * `WorkspaceState`，也不需要 `refreshWorkspace`——`persona`/`style` 是与 cockpit workspace
 * 完全独立的服务端域。
 */

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PositioningView() {
  const [systemSummary, setSystemSummary] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/persona/profile");
        const json = await res.json();
        if (!cancelled && json.success) {
          setSystemSummary(typeof json.data.systemSummary === "string" ? json.data.systemSummary : "");
        }
      } catch {
        // 静默失败——这里只是置顶展示区，下方 PersonaCard 会独立取数并展示自己的错误提示，
        // 不需要在两处重复报错骚扰用户。
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <section className="page positioning-page">
    <div className="page-heading">
      <span className="eyebrow">POSITIONING</span>
      <h1>账号定位</h1>
      <p>定位是选题、写稿和热点雷达的前提——先写清楚你是谁、想吸引谁、擅长讲什么，再谈内容生产。</p>
    </div>

    <section className="panel positioning-summary-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">SUMMARY</span><h2>定位体系报告</h2></div>
        {systemSummary ? <button type="button" className="text-button" onClick={() => downloadMarkdown("账号定位体系.md", systemSummary)}>导出 .md</button> : null}
      </div>
      {loading
        ? <p className="muted">加载中…</p>
        : systemSummary
          ? <pre className="system-summary-body">{systemSummary}</pre>
          : <p className="goal-empty-copy">完成访谈与调研后，这里会生成你的定位一页纸</p>}
    </section>

    <PersonaCard />
    <StyleProfileCard />
  </section>;
}
