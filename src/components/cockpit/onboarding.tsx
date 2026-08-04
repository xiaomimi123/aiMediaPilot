"use client";

import { useState } from "react";
import type { CreatorProfile } from "@/lib/cockpit/model";
import { creatorMark, dashboardTitle } from "./shared";

export function Onboarding({ start }: { start: (mode: "demo" | "blank", profile: CreatorProfile) => void }) {
  const [creatorName, setCreatorName] = useState("");
  const [primaryPlatform, setPrimaryPlatform] = useState("小红书");
  const [contentFocus, setContentFocus] = useState("");
  const profile: CreatorProfile = {
    creatorName: creatorName.trim(),
    dashboardTitle: `${creatorName.trim() || "我的"}的自媒体 Dashboard`,
    primaryPlatform: primaryPlatform.trim() || "小红书",
    contentFocus: contentFocus.trim(),
  };

  return <div className="modal-backdrop onboarding-backdrop"><div className="onboarding">
    <span className="brand-mark large">{creatorMark(profile)}</span>
    <span className="eyebrow">CREATOR COCKPIT</span>
    <h1>先把它变成你的工作台。</h1>
    <p>填写三个简单信息，内容与目标数据仍只保存在这台设备，不需要注册。</p>
    <div className="onboarding-profile">
      <label><span>姓名 / 昵称</span><input autoFocus value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="例如 小林" /></label>
      <label><span>主要平台</span><input list="onboarding-platform-options" value={primaryPlatform} onChange={(event) => setPrimaryPlatform(event.target.value)} /><datalist id="onboarding-platform-options"><option value="小红书" /><option value="抖音" /><option value="B站" /><option value="视频号" /><option value="多平台" /></datalist></label>
      <label><span>内容方向</span><input value={contentFocus} onChange={(event) => setContentFocus(event.target.value)} placeholder="例如 AI 产品与工作流" /></label>
    </div>
    <div className="onboarding-title-preview"><span>{creatorMark(profile)}</span><div><small>你的看板</small><strong>{dashboardTitle(profile)}</strong></div></div>
    <div className="onboarding-options"><button onClick={() => start("demo", profile)}><strong>从示例开始</strong><span>先体验灵感池与完整内容流程，再替换成自己的内容</span><em>推荐 →</em></button><button onClick={() => start("blank", profile)}><strong>从空白开始</strong><span>只保留默认内容类型，建立自己的第一张灵感卡片</span><em>开始 →</em></button></div>
    <small>之后可以在“设置与备份”中修改个人信息、导出或恢复数据。</small>
  </div></div>;
}
