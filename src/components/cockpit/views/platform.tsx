"use client";

import { useEffect, useState, type DragEvent } from "react";
import {
  PLATFORM_LABELS,
  type ContentPlatformEx,
  type ContentStage,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { Icon } from "../shared";
import { ContentOverviewView } from "./pipeline";

// 三期 T5: 平台流水线页。侧栏 5 个 platform-* 视图共用这一个组件 (Cockpit.tsx
// 按 view 推导出 platform 传入)，不为每个平台单独开文件。三区结构：
//  ① 产出区 —— 「+ 新建内容」(platform 由调用方预置) + 能力分级说明；
//  ② 看板区 —— 内嵌 ContentOverviewView (platformFilter 过滤 + hideHeading 去重标题)；
//  ③ 分发区 —— 拉取 /api/v1/cockpit/distributions?platform=，只读展示。

// 抽屉内 AI 生成脚本 (content-drawer.tsx 的 scriptPlatform) 只覆盖
// @/lib/platform 的 ContentPlatform 三个值 (douyin/xiaohongshu/gongzhonghao)；
// 5 个侧栏平台里只有 douyin/xiaohongshu 落在这个集合内。bilibili/x/youtube
// 目前没有生成能力，只能手写脚本骨架，写完后走分发登记。
const FULL_GENERATION_PLATFORMS: ReadonlySet<ContentPlatformEx> = new Set(["douyin", "xiaohongshu"]);

function capabilityCopy(platform: ContentPlatformEx): string {
  return FULL_GENERATION_PLATFORMS.has(platform)
    ? "支持抽屉内 AI 生成：新建内容后可在脚本阶段直接生成初稿。"
    : "暂不支持 AI 生成：手写脚本骨架，完成后在脚本详情页登记分发。";
}

interface DistributionItem {
  id: string;
  platform: string;
  url: string;
  publishedAt: string;
  sourceTopic: string;
}

function DistributionPanel({ platform }: { platform: ContentPlatformEx }) {
  const [items, setItems] = useState<DistributionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetch(`/api/v1/cockpit/distributions?platform=${platform}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setItems(json.data.items);
        else setError(json.message ?? "加载失败");
      })
      .catch(() => {
        if (!cancelled) setError("加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  return <section className="panel platform-distribution-panel">
    <div className="panel-heading"><div><span className="eyebrow">DISTRIBUTION</span><h2>分发记录</h2></div></div>
    {items === null && !error ? <p className="muted platform-distribution-status">加载中…</p> : null}
    {error ? <p className="muted platform-distribution-status">{error}</p> : null}
    {items && items.length === 0 ? <p className="muted platform-distribution-status">还没有登记到这个平台的分发。在脚本详情页登记分发后，会出现在这里。</p> : null}
    {items && items.length > 0 ? <div className="platform-distribution-list">{items.map((item) => <article key={item.id} className="platform-distribution-card">
      <strong>{item.sourceTopic}</strong>
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> : null}
      <time>{item.publishedAt.slice(0, 10)}</time>
    </article>)}</div> : null}
  </section>;
}

export function PlatformView({ platform, state, pageTitle, updateTitle, query, setQuery, type, setType, open, addToday, dropStage, createContent }: {
  platform: ContentPlatformEx;
  state: WorkspaceState;
  pageTitle: string;
  updateTitle: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  open: (id: string) => void;
  addToday: (id: string) => void;
  dropStage: (event: DragEvent, stage: ContentStage) => void;
  createContent: () => void;
}) {
  return <section className="page platform-page">
    <div className="page-heading"><span className="eyebrow">PLATFORM</span><h1>{PLATFORM_LABELS[platform]}</h1><p>这个平台从新建到分发的完整流水线：产出、看板、分发登记都在这一页。</p></div>
    <section className="panel platform-output-panel">
      <div className="panel-heading"><div><span className="eyebrow">OUTPUT</span><h2>产出</h2></div><button className="primary-button" onClick={createContent}><Icon name="plus" />新建内容</button></div>
      <p className="muted platform-capability-copy">{capabilityCopy(platform)}</p>
    </section>
    <ContentOverviewView
      state={state}
      pageTitle={pageTitle}
      updateTitle={updateTitle}
      query={query}
      setQuery={setQuery}
      type={type}
      setType={setType}
      open={open}
      addToday={addToday}
      dropStage={dropStage}
      platformFilter={platform}
      hideHeading
    />
    <DistributionPanel platform={platform} />
  </section>;
}
