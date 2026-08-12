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

// 侧栏固定项 (排除 settings 单独按钮, 以及暂留但不出现在侧栏里的 goals/review)。
export type FixedNavId = Exclude<NavView, "settings" | "goals" | "review">;
export type SidebarNavItem = { id: FixedNavId; label: string; icon: string };

// 工作台组 —— ✣ 灵感库选题 / ◫ 今日推进。
export const WORKBENCH_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "inspirations", label: "灵感库选题", icon: "inspiration" },
  { id: "momentum", label: "今日推进", icon: "momentum" },
];

// 创作组 —— 五平台, 顺序沿用 CONTENT_PLATFORMS。纯文字 + ▸ 前缀, 不占用独立图形语言。
export const PLATFORM_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = CONTENT_PLATFORMS.map((platform) => ({
  id: `platform-${platform}` as PlatformNavId,
  label: PLATFORM_LABELS[platform],
  icon: "platform",
}));

// ▦ 内容总览 / ◎ 内容数据分析。
export const OVERVIEW_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "pipeline", label: "内容总览", icon: "pipeline" },
  { id: "analytics", label: "内容数据分析", icon: "analytics" },
];

export const ALL_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  ...WORKBENCH_NAV_ITEMS,
  ...PLATFORM_NAV_ITEMS,
  ...OVERVIEW_NAV_ITEMS,
];

// 移动端底部导航精简快捷方式 —— 九项挤不进一屏, 只保留工作台组 + 内容总览/内容数据分析。
export const MOBILE_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  ...WORKBENCH_NAV_ITEMS,
  ...OVERVIEW_NAV_ITEMS,
];

export function isExternalActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  timeProgress: number;
  weeksRemaining: number;
  appVersion: string;
  onOpenVersionHistory: () => void;
};

type ExternalSidebarProps = { mode: "external" };

type SidebarProps = CockpitSidebarProps | ExternalSidebarProps;

/**
 * 全站共用侧栏。三期 IA (T2) 起结构固定为三段：工作台组（灵感库选题/今日推进）→
 * 创作组（五平台，标签「创作」）→ 内容总览/内容数据分析。不再支持拖拽排序。
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
        <button className="brand" onClick={props.onBrandClick} aria-label="返回今日 Todo">
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
        <div className="sidebar-group-label">创作</div>
        {PLATFORM_NAV_ITEMS.map(renderItem)}
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
