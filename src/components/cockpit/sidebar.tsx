"use client";

import type { DragEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { percent } from "@/lib/cockpit/calculations";
import type { NavigationItemId } from "@/lib/cockpit/model";
import { APP_NAME } from "@/lib/constants";
import { Icon, ProgressBar } from "./shared";

export type SidebarNavItem = { id: NavigationItemId; label: string; icon: string };
type NavView = NavigationItemId | "settings";

export const NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "inspirations", label: "灵感池", icon: "inspiration" },
  { id: "momentum", label: "推进", icon: "momentum" },
  { id: "schedule", label: "档期规划", icon: "schedule" },
  { id: "pipeline", label: "内容总览", icon: "pipeline" },
  { id: "goals", label: "大目标", icon: "goals" },
  { id: "review", label: "复盘实验室", icon: "review" },
];

// 站外落地页：创作 / 数据 / 账号 / 设置。内容库 (/content) 即将被 Pipeline 取代，不挂入新壳。
const EXTERNAL_NAV_ITEMS: ReadonlyArray<{ href: string; label: string; emoji: string }> = [
  { href: "/agent", label: "创作", emoji: "🪄" },
  { href: "/dashboard", label: "数据", emoji: "📊" },
  { href: "/accounts", label: "账号", emoji: "👤" },
  { href: "/settings", label: "设置", emoji: "⚙️" },
];

function isExternalActive(pathname: string | null, href: string): boolean {
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
  navItems: SidebarNavItem[];
  activeView: NavView;
  onSelectView: (id: NavigationItemId) => void;
  onSelectSettings: () => void;
  reviewDueCount: number;
  draggedNavId: NavigationItemId | null;
  navDropTarget: NavigationItemId | null;
  setDraggedNavId: (id: NavigationItemId | null) => void;
  setNavDropTarget: (id: NavigationItemId | null) => void;
  reorderNavigation: (sourceId: NavigationItemId, targetId: NavigationItemId) => void;
  moveNavigationBy: (id: NavigationItemId, offset: -1 | 1) => void;
  timeProgress: number;
  weeksRemaining: number;
  appVersion: string;
  onOpenVersionHistory: () => void;
};

type ExternalSidebarProps = { mode: "external" };

type SidebarProps = CockpitSidebarProps | ExternalSidebarProps;

/**
 * 全站共用侧栏。cockpit 模式：拖拽排序 / 折叠 / 视图内切换，行为与原 Cockpit.tsx 内联实现一致。
 * external 模式（挂在 /agent /dashboard /accounts /settings 等落地页外壳里）：
 * 工作台视图项渲染为回到 `/?view=<id>` 的静态链接，不支持拖拽/折叠；
 * 底部新增 创作/数据/账号/设置 外链分组，两种模式都渲染，按路径高亮当前所在页面。
 */
export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  const collapsed = props.mode === "cockpit" ? props.collapsed : false;

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
        {(props.mode === "cockpit" ? props.navItems : NAV_ITEMS).map((item) => {
          if (props.mode === "cockpit") {
            const cockpit = props;
            const active = cockpit.activeView === item.id;
            return <button
              key={item.id}
              draggable
              className={`nav-item${active ? " active" : ""}${cockpit.draggedNavId === item.id ? " dragging" : ""}${cockpit.navDropTarget === item.id && cockpit.draggedNavId !== item.id ? " drop-target" : ""}`}
              onClick={() => cockpit.onSelectView(item.id)}
              onDragStart={(event: DragEvent) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                cockpit.setDraggedNavId(item.id);
              }}
              onDragOver={(event: DragEvent) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                cockpit.setNavDropTarget(item.id);
              }}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                const sourceId = (event.dataTransfer.getData("text/plain") || cockpit.draggedNavId) as NavigationItemId;
                cockpit.reorderNavigation(sourceId, item.id);
                cockpit.setDraggedNavId(null);
                cockpit.setNavDropTarget(null);
              }}
              onDragEnd={() => {
                cockpit.setDraggedNavId(null);
                cockpit.setNavDropTarget(null);
              }}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                event.preventDefault();
                cockpit.moveNavigationBy(item.id, event.key === "ArrowUp" ? -1 : 1);
              }}
              aria-label={`${item.label}，可拖动调整顺序`}
              title={collapsed ? item.label : "拖动调整顺序；Alt + ↑/↓ 也可移动"}
            ><Icon name={item.icon} /><span>{item.label}</span>{item.id === "review" && cockpit.reviewDueCount > 0 ? <em>{cockpit.reviewDueCount}</em> : null}<span className="nav-drag-handle" aria-hidden="true">⠿</span></button>;
          }
          return <Link key={item.id} href={`/?view=${item.id}`} className="nav-item" title={item.label}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>;
        })}
      </nav>

      <div className="sidebar-bottom">
        {props.mode === "cockpit" ? (
          <button className={props.activeView === "settings" ? "nav-item active" : "nav-item"} onClick={props.onSelectSettings} aria-label="设置与备份" title={collapsed ? "设置与备份" : undefined}><Icon name="settings" /><span>设置与备份</span></button>
        ) : null}

        <div className="nav-section-label">平台</div>
        {EXTERNAL_NAV_ITEMS.map((item) => {
          const active = isExternalActive(pathname, item.href);
          return <Link key={item.href} href={item.href} className={active ? "nav-item active" : "nav-item"} title={collapsed ? item.label : undefined}>
            <span className="icon" aria-hidden="true">{item.emoji}</span><span>{item.label}</span>
          </Link>;
        })}

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
