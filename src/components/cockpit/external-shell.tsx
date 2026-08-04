"use client";

import { useEffect, type ReactNode } from "react";
import { Sidebar } from "./sidebar";

type ColorTheme = "light" | "dark";

/**
 * 站外落地页（/agent /dashboard /accounts /settings 等）的外壳：复用 cockpit 的侧栏
 * （external 模式）+ .main-area 容器，让这些旧页面看起来挂在同一个壳里。
 * 主题：启动时读取 cockpit 写入的 localStorage（creator-cockpit-theme /
 * creator-cockpit-style），同步到 <html> 的 dataset + .dark，与驾驶舱视觉一致。
 */
export function ExternalShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    let theme: ColorTheme = "light";
    let style = "editorial";
    try {
      const storedTheme = window.localStorage.getItem("creator-cockpit-theme");
      if (storedTheme === "dark" || storedTheme === "light") theme = storedTheme;
      const storedStyle = window.localStorage.getItem("creator-cockpit-style");
      if (storedStyle) style = storedStyle;
    } catch {
      // localStorage 不可用（隐私模式等），保留默认浅色/编辑部风格
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.style = style;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, []);

  return (
    <div className="cockpit-shell">
      <Sidebar mode="external" />
      <main className="main-area">
        <div className="p-3 md:p-6">{children}</div>
      </main>
    </div>
  );
}
