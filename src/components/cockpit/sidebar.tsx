"use client";

import Link from "next/link";
import { percent } from "@/lib/cockpit/calculations";
import { CONTENT_PLATFORMS, PLATFORM_LABELS } from "@/lib/cockpit/model";
// NavView/PlatformNavId 的唯一定义现在在 view-routing.ts (纯逻辑模块, 供
// `resolveInitialView`/`resolveInitialMomentumTab` 单测复用, 不依赖本文件的
// next/link "use client" 组件代码) —— 这里只做 type-only import, 避免环形依赖。
import type { NavView, PlatformNavId } from "@/lib/cockpit/view-routing";
import { APP_NAME } from "@/lib/constants";
import { Icon, ProgressBar } from "./shared";

// 侧栏固定项 (排除 settings 单独按钮; goals/review 已在 T4 从 NavView 联合中整体移除)。
export type FixedNavId = Exclude<NavView, "settings">;
export type SidebarNavItem = { id: FixedNavId; label: string; icon: string };

// 工作台组 —— ◌ 账号定位 (十一期新增, T1) / ✣ 灵感库选题 / ◉ 热点雷达 (四期新增, T6)。
// 「账号定位」放在最前面: 定位是内容战略资产, 是选题/写稿一切动作的前提,
// 十期把它塞进设置页与 API key 并列造成语义错位, 用户明确要求独立成侧栏第一栏
// (见 docs/superpowers/specs/2026-08-15-positioning-view-design.md)。视图组件本身在 T2
// 落地, 这里先占住导航位置。「热点雷达」紧跟在「灵感库选题」下面: 采纳雷达条目就是写进
// 灵感库 (见 items/[id] PATCH adopt), 两者是同一条数据管线的前后段, 放在一起符合心智。
// 十六期 (T3): 「今日推进」从这里移除——并入新首页 (T4/T5), 不再是独立侧栏项。
export const WORKBENCH_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "positioning", label: "账号定位", icon: "positioning" },
  { id: "inspirations", label: "灵感库选题", icon: "inspiration" },
  { id: "radar", label: "热点雷达", icon: "radar" },
];

// 创作组 —— 五平台, 顺序沿用 CONTENT_PLATFORMS。纯文字 + ▸ 前缀, 不占用独立图形语言。
// 十六期 (T3): 不再在侧栏渲染 (见下方 Sidebar 组件的 nav JSX)——平台看板并入新首页 (T4/T5)。
// 常量本身保留导出, 避免破坏潜在的类型引用/未来复用。
export const PLATFORM_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = CONTENT_PLATFORMS.map((platform) => ({
  id: `platform-${platform}` as PlatformNavId,
  label: PLATFORM_LABELS[platform],
  icon: "platform",
}));

// ▦ 模板 (二十期新增): 放在「内容数据分析」之前——模板管理与出片是内容生产的
// 出口, 语义上和数据分析并列, 但先看模板再看数据更符合创作顺序。图标复用 Icon
// 组件里 "pipeline" 键 (▦ 网格字形, shared.tsx 未在任何侧栏项里被引用——内容总览
// 早已并入首页不再占用图标, 见上方 PLATFORM_NAV_ITEMS 注释), 网格意象也贴近
// 「模板卡片」的直觉, 不新增 Icon 图标资源。
// ◎ 内容数据分析。十六期 (T3): 「内容总览」从这里移除——并入新首页 (T4/T5)。
export const OVERVIEW_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "templates", label: "模板", icon: "pipeline" },
  // ◫ (momentum 键) 在当前侧栏未被任何项占用, 形似画框, 贴合「成片」; 不复用
  // ✣ (inspiration) —— 它已被「灵感库选题」占用, 相邻复用会造成视觉混淆。
  { id: "productions", label: "成片", icon: "momentum" },
  { id: "analytics", label: "内容数据分析", icon: "analytics" },
];

export const ALL_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  ...WORKBENCH_NAV_ITEMS,
  ...OVERVIEW_NAV_ITEMS,
];

// 移动端底部导航精简快捷方式 —— 现在与 ALL_NAV_ITEMS 等价 (工作台组 + 内容数据分析)。
export const MOBILE_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  ...WORKBENCH_NAV_ITEMS,
  ...OVERVIEW_NAV_ITEMS,
];

type CockpitSidebarProps = {
  mode: "cockpit";
  collapsed: boolean;
  onToggleCollapsed: () => void;
  brandTitle: string;
  brandMark: string;
  brandSubtitle: string;
  onBrandClick: () => void;
  activeView: NavView;
  onSelectView: (id: FixedNavId) => void;
  onSelectSettings: () => void;
  // 待复盘徽标 —— 恢复 T2 之前挂在旧「复盘」侧栏项上的数量提示, 现在挂在合并后的
  // 「内容数据分析」项上（数据源逻辑不变, 见 Cockpit.tsx 的 reviewDueCount）。
  analyticsBadgeCount: number;
  timeProgress: number;
  weeksRemaining: number;
  appVersion: string;
  onOpenVersionHistory: () => void;
};

type ExternalSidebarProps = { mode: "external" };

type SidebarProps = CockpitSidebarProps | ExternalSidebarProps;

/**
 * 全站共用侧栏。十六期 (T3) 起收窄为 4 项：工作台组（账号定位/灵感库选题/热点雷达）→
 * 内容数据分析。不再渲染「创作」分组标题与五平台入口，也不再渲染「内容总览」——
 * 均并入新首页 (T4/T5)。不再支持拖拽排序。
 * cockpit 模式：折叠 / 视图内切换。
 * external 模式（挂在 /accounts /content 等落地页外壳里）：
 * 工作台视图项渲染为回到 `/?view=<id>` 的静态链接，不支持折叠。
 * 二期 T6 起：/agent /dashboard /settings 壳页退役（redirect 回 cockpit 单页视图），
 * 底部的「平台」外链分组随之整段移除——/accounts 桌面入口改由 goals 状态条 +
 * settings 卡片承担（双入口），移动端导航另见 external-shell.tsx。
 */
export function Sidebar(props: SidebarProps) {
  const collapsed = props.mode === "cockpit" ? props.collapsed : false;

  function renderItem(item: SidebarNavItem) {
    if (props.mode === "cockpit") {
      const cockpit = props;
      const active = cockpit.activeView === item.id;
      return (
        <button
          key={item.id}
          className={active ? "nav-item active" : "nav-item"}
          onClick={() => cockpit.onSelectView(item.id)}
          aria-label={item.label}
          title={collapsed ? item.label : undefined}
        >
          <Icon name={item.icon} /><span>{item.label}</span>
          {item.id === "analytics" && cockpit.analyticsBadgeCount > 0 ? <em>{cockpit.analyticsBadgeCount}</em> : null}
        </button>
      );
    }
    return (
      <Link key={item.id} href={`/?view=${item.id}`} className="nav-item" title={item.label}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </Link>
    );
  }

  return (
    <aside className="sidebar">
      {props.mode === "cockpit" ? (
        <button
          className="sidebar-toggle"
          onClick={props.onToggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        ><span aria-hidden="true">{collapsed ? "›" : "‹"}</span></button>
      ) : null}

      {props.mode === "cockpit" ? (
        <button className="brand" onClick={props.onBrandClick} aria-label="返回首页">
          <span className="brand-mark">{props.brandMark}</span><span><strong>{props.brandTitle}</strong><small>{props.brandSubtitle}</small></span>
        </button>
      ) : (
        <Link className="brand" href="/" aria-label={`返回 ${APP_NAME} 工作台`}>
          <span className="brand-mark">{APP_NAME.slice(0, 1)}</span><span><strong>{APP_NAME}</strong><small>创作工作台</small></span>
        </Link>
      )}

      <nav aria-label="主导航">
        <div className="nav-section-label">工作台</div>
        {WORKBENCH_NAV_ITEMS.map(renderItem)}
        {OVERVIEW_NAV_ITEMS.map(renderItem)}
      </nav>

      <div className="sidebar-bottom">
        {props.mode === "cockpit" ? (
          <button className={props.activeView === "settings" ? "nav-item active" : "nav-item"} onClick={props.onSelectSettings} aria-label="设置与备份" title={collapsed ? "设置与备份" : undefined}><Icon name="settings" /><span>设置与备份</span></button>
        ) : null}

        {props.mode === "cockpit" ? (
          <>
            <div className="quarter-mini"><div><span>当前目标进度</span><strong>{percent(props.timeProgress)}</strong></div><ProgressBar value={props.timeProgress} /><small>{props.weeksRemaining} 周后结束 · 本机自动保存</small></div>
            <button className="version-entry" onClick={props.onOpenVersionHistory} aria-label={`当前版本 ${props.appVersion}，查看版本记录`} title={collapsed ? `v${props.appVersion}` : undefined}>
              <Icon name="version" />
              <span><small>当前版本</small><strong>v{props.appVersion}</strong></span>
              <em>版本记录</em>
            </button>
          </>
        ) : (
          <div className="version-entry" aria-hidden="true">
            <Icon name="version" /><span><small>当前工作台</small><strong>{APP_NAME}</strong></span>
          </div>
        )}
      </div>
    </aside>
  );
}
