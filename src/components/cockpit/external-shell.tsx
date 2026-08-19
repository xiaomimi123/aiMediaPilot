"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isExternalActive, Sidebar } from "./sidebar";
import { Icon } from "./shared";

// 移动端底部导航（<820px，.sidebar 隐藏）里露出的工作台视图快捷入口。
//
// 十六期 (T3) 把「今日推进」(momentum) 和「内容总览」(pipeline) 都从侧栏拿掉，
// 合并进了新首页 (`view === "home"`, 见 view-routing.ts `resolveInitialView`)——
// 两者原本指向的目的地现在是同一个，继续保留两个快捷格子会重复跳到同一处，故收窄
// 为 1 项，直接指向新首页。图标沿用旧「内容总览」用过的 "pipeline"（Icon 组件
// `shared.tsx` 里仍有定义），对「首页」这个目的地依然读得通，不必新造一个图标名。
// positioning/inspirations/radar 三项**不**加进来：站外落地页 (`/accounts` 等)
// 屏幕小、导航位有限，它们都属于 Cockpit 内部工作流，这里维持精简。
const MOBILE_COCKPIT_SHORTCUTS = [
  { id: "home", label: "首页", icon: "pipeline" } as const,
];

// 二期 T6 起 /agent /dashboard /settings 壳页退役, 桌面侧栏「平台」分组整段移除
// （/accounts 桌面入口改由 goals 状态条 + settings 卡片承担）。移动端屏幕小,
// 仍保留一个 /accounts 快捷格子, 否则触屏用户完全够不到账号管理入口。
const MOBILE_ACCOUNTS_ITEM = { href: "/accounts", label: "账号", emoji: "◎" } as const;

/**
 * 站外落地页（/accounts /content 等）的外壳：复用 cockpit 的侧栏
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
        <Link
          href={MOBILE_ACCOUNTS_ITEM.href}
          className={isExternalActive(pathname, MOBILE_ACCOUNTS_ITEM.href) ? "active" : ""}
        >
          <span className="icon" aria-hidden="true">{MOBILE_ACCOUNTS_ITEM.emoji}</span><span>{MOBILE_ACCOUNTS_ITEM.label}</span>
        </Link>
      </nav>
    </div>
  );
}
