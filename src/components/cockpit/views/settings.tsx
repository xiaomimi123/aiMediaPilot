"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PAGE_TITLES,
  type CreatorProfile,
  type DesignStyle,
  type WorkspaceState,
} from "@/lib/cockpit/model";
import { getExtras } from "@/lib/cockpit/storage";
import { EditablePageTitle, creatorMark, dashboardTitle, normalizeGoalQuotas } from "../shared";
import { AIProviderCard } from "../settings-cards/ai-provider-card";
import { BaselineCard } from "../settings-cards/baseline-card";
import { RadarConfigCard } from "../settings-cards/radar-config-card";
import { StyleProfileCard } from "../settings-cards/style-profile-card";

const DESIGN_STYLE_OPTIONS: ReadonlyArray<{
  id: DesignStyle;
  name: string;
  tagline: string;
  description: string;
}> = [
  { id: "editorial", name: "安静编辑部", tagline: "温和 · 内容感", description: "米白纸张、宋体标题和陶土色强调，也是唯一支持深色模式的风格。" },
  { id: "swiss", name: "瑞士海报", tagline: "大胆 · 强秩序", description: "黑白网格、粗线和大字号，让信息像平面海报一样直接。" },
  { id: "future", name: "未来实验室", tagline: "科技 · 轻盈", description: "渐变、柔光和悬浮面板，让看板更像一套 Creator OS。" },
  { id: "retro", name: "复古操作台", tagline: "经典桌面系统", description: "窗口标题栏、等宽数字和硬朗控件，带有早期桌面软件质感。" },
  { id: "bauhaus", name: "包豪斯积木", tagline: "几何 · 创意", description: "鲜明色块和几何模块，兼顾创作活力与清晰的信息组织。" },
] as const;

export function SettingsView({ state, pageTitle, updateTitle, updateDesignStyle, setState, onReset }: { state: WorkspaceState; pageTitle: string; updateTitle: (value: string) => void; updateDesignStyle: (designStyle: DesignStyle) => void; setState: React.Dispatch<React.SetStateAction<WorkspaceState>>; onReset: () => void }) {
  const [newType, setNewType] = useState("");
  const { settings } = getExtras();
  const updateProfile = (patch: Partial<CreatorProfile>) => setState((prev) => ({
    ...prev,
    profile: { ...prev.profile, ...patch },
  }));
  const updateCreatorName = (value: string) => setState((prev) => {
    const previousDefault = `${prev.profile.creatorName.trim() || "我的"}的自媒体 Dashboard`;
    const shouldFollowName = !prev.profile.dashboardTitle.trim() || prev.profile.dashboardTitle === previousDefault;
    return {
      ...prev,
      profile: {
        ...prev.profile,
        creatorName: value,
        dashboardTitle: shouldFollowName ? `${value.trim() || "我的"}的自媒体 Dashboard` : prev.profile.dashboardTitle,
      },
    };
  });

  return <section className="page settings-page">
    <div className="page-heading"><span className="eyebrow">SETTINGS</span><EditablePageTitle value={pageTitle} fallback={DEFAULT_PAGE_TITLES.settings} onChange={updateTitle} /><p>先把工作台变成你的，再放心把内容数据留在当前设备。</p></div>
    <div className="settings-grid">
      <div className="panel settings-card wide appearance-settings-card">
        <div className="settings-icon">◐</div>
        <div>
          <h2>外观风格</h2>
          <p>选择后会立即应用到整个工作台，并随本地数据自动保存。“安静编辑部”支持深色，其余风格目前仅提供浅色。</p>
          <div className="design-style-grid" role="radiogroup" aria-label="选择设计风格">
            {DESIGN_STYLE_OPTIONS.map((option) => <button
              key={option.id}
              type="button"
              className={state.designStyle === option.id ? "design-style-option active" : "design-style-option"}
              role="radio"
              aria-checked={state.designStyle === option.id}
              onClick={() => updateDesignStyle(option.id)}
            >
              <span className={`design-style-preview preview-${option.id}`} aria-hidden="true">
                <i className="preview-sidebar"><b>{option.id === "retro" ? "CC" : option.id === "bauhaus" ? "●" : creatorMark(state.profile)}</b><em /><em /><em /></i>
                <i className="preview-workspace">
                  <b>{option.id === "swiss" ? "TODAY / 03" : option.id === "future" ? "Creator OS" : option.id === "retro" ? "Task_Manager.exe" : option.id === "bauhaus" ? "今天做什么？" : "今日推进"}</b>
                  <span><em /><em /><em /></span>
                  <span><em /><em /></span>
                </i>
              </span>
              <span className="design-style-copy"><strong>{option.name}</strong><small>{option.tagline}</small><em>{option.description}</em></span>
              <span className="design-style-support">{option.id === "editorial" ? "支持深色" : "仅浅色"}</span>
            </button>)}
          </div>
        </div>
      </div>

      <div className="panel settings-card wide profile-settings-card">
        <div className="settings-icon">{creatorMark(state.profile)}</div>
        <div>
          <h2>创作者档案</h2>
          <p>这些信息只用于个性化工作台，不会公开上传。看板名称会同步到侧边栏和浏览器标签。</p>
          <div className="profile-settings-grid">
            <label className="field"><span>用户姓名 / 昵称</span><input value={state.profile.creatorName} onChange={(event) => updateCreatorName(event.target.value)} placeholder="例如 小林" /></label>
            <label className="field"><span>看板名称</span><input value={state.profile.dashboardTitle} onChange={(event) => updateProfile({ dashboardTitle: event.target.value })} placeholder={`${state.profile.creatorName || "我的"}的自媒体 Dashboard`} /></label>
            <label className="field"><span>主要平台</span><input list="settings-platform-options" value={state.profile.primaryPlatform} onChange={(event) => updateProfile({ primaryPlatform: event.target.value })} placeholder="例如 小红书" /><datalist id="settings-platform-options"><option value="小红书" /><option value="抖音" /><option value="B站" /><option value="视频号" /><option value="多平台" /></datalist></label>
            <label className="field"><span>内容方向</span><input value={state.profile.contentFocus} onChange={(event) => updateProfile({ contentFocus: event.target.value })} placeholder="例如 AI 产品与工作流" /></label>
          </div>
          <div className="profile-preview"><span className="brand-mark">{creatorMark(state.profile)}</span><div><small>看板标题预览</small><strong>{dashboardTitle(state.profile)}</strong><em>{state.profile.primaryPlatform || "未设置平台"}{state.profile.contentFocus ? ` · ${state.profile.contentFocus}` : ""}</em></div></div>
        </div>
      </div>

      <div className="panel settings-card wide"><div className="settings-icon">#</div><div><h2>内容类型</h2><p>每条内容只能有一个主要类型。类型会用于大目标配额和复盘对比。</p><div className="type-chips">{state.contentTypes.map((type) => <span key={type}>{type}<button aria-label={`删除${type}`} onClick={() => setState((prev) => { const quotas = normalizeGoalQuotas(prev.goal.outputTarget, prev.goal.quotas.filter((item) => item.contentType !== type)); return { ...prev, contentTypes: prev.contentTypes.filter((item) => item !== type), goal: { ...prev.goal, quotas } }; })}>×</button></span>)}</div><div className="add-type"><input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="添加新的内容类型" /><button onClick={() => { const value = newType.trim(); if (!value || value === "其他" || state.contentTypes.includes(value)) return; setState((prev) => { const quotas = normalizeGoalQuotas(prev.goal.outputTarget, [...prev.goal.quotas, { contentType: value, target: 0 }]); return { ...prev, contentTypes: [...prev.contentTypes, value], goal: { ...prev.goal, quotas } }; }); setNewType(""); }}>添加</button></div></div></div>
      <div className="panel settings-card danger-card"><div className="settings-icon">!</div><div><h2>清空工作台</h2><p>删除当前浏览器中的全部内容与目标数据，保留创作者档案。操作前请先导出备份。</p><button className="danger-button" onClick={onReset}>清空内容与目标</button></div></div>

      <AIProviderCard />
      <BaselineCard baselinePlays={settings.baselinePlays} retroMedian={settings.retroMedian} retroCount={settings.retroCount} />
      <RadarConfigCard />
      <StyleProfileCard />
      <div className="panel settings-card"><div className="settings-icon">⇄</div><div><h2>账号管理</h2><p>绑定抖音 / 小红书账号、查看登录状态与手动同步，都在独立的账号管理页完成——这里只是第二个入口。</p><Link className="text-button" href="/accounts">前往账号管理 →</Link></div></div>
    </div>
  </section>;
}
