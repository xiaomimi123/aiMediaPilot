"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EXTERNAL_NAV_ITEMS, isExternalActive, NAV_ITEMS, Sidebar } from "./sidebar";
import { Icon } from "./shared";

// 移动端底部导航（<820px，.sidebar 隐藏）里露出的 2 个工作台视图快捷入口。
// 与桌面侧栏一致地回到 `/?view=<id>`；6 个格子里剩余 4 个给站外落地页本身。
const MOBILE_COCKPIT_SHORTCUTS = NAV_ITEMS.filter((item) => item.id === "inspirations" || item.id === "momentum");

/**
 * 站外落地页（/agent /dashboard /accounts /settings 等）的外壳：复用 cockpit 的侧栏
 * （external 模式）+ .main-area 容器，让这些旧页面看起来挂在同一个壳里。
 * 主题：根布局 (`src/app/layout.tsx`) 里的 pre-hydration 内联脚本已经在首次绘制前
 * 把 cockpit 写入的 localStorage（creator-cockpit-theme / creator-cockpit-style）
 * 同步到了 <html> 的 dataset + .dark，这里不需要再补一次 post-hydration effect
 * （补了反而会在深色模式下闪一下浅色再跳回来）。
 *
 * 移动端导航：<820px 时 .sidebar 整体 display:none（cockpit.css），Cockpit.tsx 自身
 * 用 .mobile-nav 补上导航；这里补齐同款，否则站外页面在小屏上完全没有导航入口。
 */
export function ExternalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="cockpit-shell">
      <Sidebar mode="external" />
      <main className="main-area">
        <div className="p-3 md:p-6">{children}</div>
      </main>
      <nav className="mobile-nav" aria-label="移动端导航">
        {MOBILE_COCKPIT_SHORTCUTS.map((item) => (
          <Link key={item.id} href={`/?view=${item.id}`}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
        {EXTERNAL_NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={isExternalActive(pathname, item.href) ? "active" : ""}>
            <span className="icon" aria-hidden="true">{item.emoji}</span><span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
