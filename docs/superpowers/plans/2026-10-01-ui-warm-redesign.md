# 界面改版实施计划（行动优先总览 + 暖白卡片）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暖白卡片视觉；5 项导航（手机底部标签栏）；总览改为行动优先仪表盘；作品页卡片 + 阶段筛选；作品工作区六步步骤条 + 可收起的编导抽屉；设置收拢定位 / 写法库 / 公式；新增账号每日快照。

**Architecture:** 视觉靠改设计变量（`tokens.css` + `globals.css` 桥接层）与几个通用类（`.card`、`.btn-*`、`.chip`），页面逻辑不改。新的数据拼装放在纯函数里（`src/lib/overview/`），页面是薄壳。旧地址用 Next 重定向。

**Tech Stack:** Next.js 14、Tailwind、Prisma 5、vitest + testing-library；图表手写 SVG，不加依赖。

**Spec:** `docs/superpowers/specs/2026-10-01-ui-warm-redesign-design.md`

## Global Constraints

- 只有浅色；提词器保持黑底白字。
- 颜色只用 spec §4.1 表里的变量值（已按 WCAG AA 校准）；红色只表示"有问题"。
- 不引入新的界面库、图表库、图标库（已有 `lucide-react` 可用）。
- 卡片：圆角 16、无边框、双层柔和投影、内边距 16（手机 12）。
- 手机断点 768（Tailwind `md`）：小于它显示底部标签栏、内容单列、编导对话为底部面板。
- 旧地址永久重定向：`/retro` → `/works?stage=published`，`/persona` → `/settings#persona`。
- 页面逻辑、接口、数据表除 `AccountDailySnapshot` 外不改。

## Review Focus

1. **窄屏（375）下任何页面出现横向滚动** —— 底部标签栏遮住页面最后一行内容。→ Task 2 测试 `reserves space for the bottom tab bar`；Task 8 真机量 `scrollWidth`。
2. **没有任何数据（新装 / 回采从未成功）时总览报错或一片空白**。→ Task 5 测试 `shows the empty day prompt when there is nothing to do`、`handles missing account numbers`。
3. **同一天回采跑两次，快照出现两条或覆盖成空值**。→ Task 4 测试 `overwrites the same day but keeps known numbers`。
4. **编导抽屉在新通知到来时没展开，或每次刷新都反复弹开**。→ Task 6 测试 `opens the drawer once per new notice`。
5. **步骤条的"当前步骤"和项目实际阶段不一致（例如已发布但没复盘时停在发布）**。→ Task 3 测试 `marks the first unfinished step as current`。

---

## 文件结构

```
src/app/tokens.css、src/app/globals.css     暖白变量、桥接层、通用类
src/components/app-nav.tsx                   侧栏 + 底部标签栏
src/app/layout.tsx                           用 AppNav
next.config.js                               旧地址重定向
src/lib/overview/steps.ts                    六步判定、下一步文字
src/lib/overview/today.ts                    「今天」待办 / 在做 / 先发这条（纯函数）
src/lib/overview/load.ts                     总览与作品页取数
src/lib/account/daily.ts                     账号每日快照
src/components/works/work-card.tsx、step-dots.tsx
src/app/works/page.tsx
src/components/overview/today-panel.tsx、metric-cards.tsx、trend-chart.tsx、works-table.tsx
src/app/page.tsx                             总览
src/components/project/step-bar.tsx、topic-step.tsx、chat-drawer.tsx
src/components/project/project-workspace.tsx、publish-pane.tsx（section）
src/lib/project/load.ts、view.ts             bundle 增加 reference / published / hasRetro
src/components/settings/lessons-card.tsx
src/app/settings/page.tsx                    分组 + 锚点；定位、写法库、公式并入
删除：src/app/retro/page.tsx、src/app/persona/page.tsx、src/components/retro/retro-view.tsx、src/components/home/account-card.tsx（及其测试）
```

---

### Task 1: 暖白视觉变量与通用类

**Files:**
- Modify: `src/app/tokens.css`（整体替换 `:root` 内的颜色、圆角、字体变量）、`src/app/globals.css`（桥接层数值、根字号、通用类）
- Test: `tests/lib/ui/contrast.test.ts`

**Interfaces:**
- Produces：CSS 变量（spec §4.1 全部，外加 `--chart`、`--font-display`、`--shadow-card`）；类 `.card`、`.card-hero`、`.btn-primary`、`.btn-secondary`、`.chip`、`.font-display`、`.t-label`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'src/app/tokens.css'), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
  if (!m) throw new Error(`缺少变量 --${name}`);
  return m[1];
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(token(a)), lum(token(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('warm palette contrast (WCAG AA)', () => {
  it.each([
    ['text-primary', 'bg-canvas'],
    ['text-primary', 'bg-surface'],
    ['text-primary', 'bg-inset'],
    ['text-secondary', 'bg-canvas'],
    ['text-secondary', 'bg-surface'],
    ['text-secondary', 'bg-inset'],
    ['text-tertiary', 'bg-canvas'],
    ['text-tertiary', 'bg-surface'],
    ['text-tertiary', 'bg-inset'],
    ['text-on-accent', 'accent'],
    ['accent', 'bg-canvas'],
    ['accent', 'bg-surface'],
    ['accent', 'accent-subtle'],
    ['success', 'bg-surface'],
    ['success', 'success-subtle'],
    ['warning', 'bg-surface'],
    ['warning', 'warning-subtle'],
    ['danger', 'bg-surface'],
    ['danger', 'danger-subtle'],
    ['info', 'bg-surface'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('chart color is at least 3:1 on cards (graphics)', () => {
    expect(ratio('chart', 'bg-surface')).toBeGreaterThanOrEqual(3);
  });
  it('is a light theme', () => {
    expect(lum(token('bg-canvas'))).toBeGreaterThan(0.8);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/ui/contrast.test.ts`
Expected: FAIL（当前是深色，`is a light theme` 与多项对比度失败，`--chart` 缺失）。

- [ ] **Step 3: 替换 `src/app/tokens.css` 的 `:root`**

文件头注释改为"MediaPilot 设计变量 — 暖白卡片（2026-10 改版，spec 2026-10-01-ui-warm-redesign）"，`:root` 整体换成：

```css
:root {
  /* ---- 背景 ---- */
  --bg-canvas:        #F6F3EE; /* 页面底(米白) */
  --bg-base:          #FBF8F3; /* 侧栏、抽屉 */
  --bg-surface:       #FFFDF9; /* 卡片 */
  --bg-surface-hover: #F8F2EA; /* 行 / 卡片悬停、当前导航项 */
  --bg-elevated:      #F4EEE5; /* 次级按钮底、进度槽 */
  --bg-inset:         #F1ECE4; /* 输入框、内嵌块 */

  /* ---- 描边 ---- */
  --border-subtle:    #ECE6DC;
  --border-default:   #E2D9CC;
  --border-strong:    #D3C7B6;

  /* ---- 文字 ---- */
  --text-primary:     #2B2724;
  --text-secondary:   #6F655B;
  --text-tertiary:    #71665A;
  --text-disabled:    #A39787; /* 空值 "—" */
  --text-on-accent:   #FFFFFF;

  /* ---- 强调(橙棕; 只用于主操作、当前位置、链接) ---- */
  --accent:           #AD5614;
  --accent-hover:     #944810;
  --accent-subtle:    #FFF6E8;
  --accent-border:    #F3E2CF;
  --chart:            #C2651D; /* 图表线条 / 横条, 只用于图形 */

  /* ---- 状态(语义固定; 红色只表示有问题) ---- */
  --success:          #2B7A49;  --success-subtle: #E8F4EC;
  --warning:          #A64908;  --warning-subtle: #FDF0E3;
  --danger:           #C53030;  --danger-subtle:  #FBE9E7;
  --info:             #2A64A0;  --info-subtle:    #E8F0F8;
  --soft:             #7B5EA7;  --soft-subtle:    #F1ECF8;

  /* ---- 间距(4pt) ---- */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px;
  --s6:24px; --s7:32px; --s8:40px; --s9:48px;

  /* ---- 圆角 ---- */
  --r-sm:6px;
  --r-md:10px;  /* 按钮、输入框 */
  --r-lg:16px;  /* 卡片 */
  --r-xl:20px;  /* 大卡(今天) */
  --r-full:999px;

  /* ---- 投影 ---- */
  --shadow-card: 0 1px 2px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.06);
  --shadow-pop:  0 8px 28px rgba(60, 40, 20, 0.14);

  /* ---- 字体 ---- */
  --font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  --font-display: "Songti SC", "Source Han Serif SC", "Noto Serif SC", Georgia, serif;
  --mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;

  /* ---- 布局 ---- */
  --sidebar-w: 224px;
  --drawer-w:  400px;
  --tabbar-h:  60px;
}
```

（原文件底部的"字阶"注释删掉，改为一行：`/* 字号：说明 12 / 正文 14 / 卡片标题 15 粗 / 页面标题 22 粗 / 总览大数字 28（--font-display） */`。）

- [ ] **Step 4: 改 `src/app/globals.css`**

- 文件头注释改为："视觉语言：暖白卡片（2026-10 改版，spec 2026-10-01-ui-warm-redesign）。令牌真源是 tokens.css；这里把令牌桥接到 shadcn 语义变量（HSL 三元组，供 /alpha 修饰），改令牌时两处一起改。"
- `:root` 桥接层数值替换为（注释同步为对应 hex）：

```css
    --background: 37 31% 95%;        /* --bg-canvas #F6F3EE */
    --foreground: 26 9% 15%;         /* --text-primary #2B2724 */
    --card: 40 100% 99%;             /* --bg-surface #FFFDF9 */
    --card-foreground: 26 9% 15%;
    --primary: 26 79% 38%;           /* --accent #AD5614 */
    --primary-foreground: 0 0% 100%;
    --secondary: 36 41% 93%;         /* --bg-elevated #F4EEE5 */
    --secondary-foreground: 26 9% 15%;
    --muted: 34 50% 95%;             /* --bg-surface-hover #F8F2EA */
    --muted-foreground: 30 10% 40%;  /* --text-secondary #6F655B */
    --ui-hover: 34 50% 95%;
    --ui-hover-foreground: 26 9% 15%;
    --destructive: 0 61% 48%;        /* --danger #C53030 */
    --destructive-foreground: 0 0% 100%;
    --border: 37 30% 89%;            /* --border-subtle #ECE6DC */
    --input: 35 27% 84%;             /* --border-default #E2D9CC */
    --ring: 26 79% 38%;
    --radius: 10px;
    --status-success: 143 48% 32%;
    --status-warning: 25 91% 34%;
    --status-danger: 0 61% 48%;
    --status-info: 211 58% 40%;
    --status-soft: 264 29% 51%;
```

- 根字号与正文：`html { font-size: 16px; }`，`body` 改为 `font-size: 14px; line-height: 22px;`（删除原"显示比例 15px"注释，换成"正文 14、根 16：暖白版放松密度"）。
- 滚动条：`border: 3px solid var(--bg-canvas)` 不变；`:focus-visible` 的 outline 色改为 `var(--accent)`。
- `@layer components` 追加：

```css
  .card {
    background: var(--bg-surface);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-card);
    padding: 16px;
  }
  @media (max-width: 767px) {
    .card { padding: 12px; }
  }
  .card-hero {
    background: var(--accent-subtle);
    border-radius: var(--r-xl);
    padding: 16px;
  }
  .btn-primary {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 36px; padding: 0 14px; border-radius: var(--r-md);
    background: var(--accent); color: var(--text-on-accent); font-weight: 600;
  }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-primary:disabled { opacity: 0.5; }
  .btn-secondary {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 36px; padding: 0 14px; border-radius: var(--r-md);
    background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-strong);
  }
  .btn-secondary:hover { background: var(--bg-surface-hover); }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 10px; border-radius: var(--r-full); font-size: 12px; line-height: 18px;
    background: var(--bg-elevated); color: var(--text-secondary);
  }
  .font-display { font-family: var(--font-display); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
```

- `.t-label` 保留（颜色仍走 `--text-tertiary`），`font-size` 改为 12px。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/app/tokens.css src/app/globals.css tests/lib/ui
git commit -m "feat(ui): 暖白视觉变量(按 WCAG AA 校准) + 卡片/按钮/胶囊通用类

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 导航（侧栏 + 底部标签栏）与旧地址重定向

**Files:**
- Create: `src/components/app-nav.tsx`
- Modify: `src/app/layout.tsx`、`next.config.js`
- Test: `tests/components/app-nav.test.tsx`、`tests/lib/ui/redirects.test.ts`

**Interfaces:**
- Produces：`NAV_ITEMS = [{ href: '/', label: '总览', icon }, { href: '/works', label: '作品' }, { href: '/topics', label: '选题' }, { href: '/assistant', label: '助手' }, { href: '/settings', label: '设置' }]`；`isActive(pathname, href)`（`/` 只匹配自身；`/works` 也匹配 `/projects/*`）；`AppNav()`；`next.config.js` 导出 `redirects()`

- [ ] **Step 1: 写失败测试**

`tests/components/app-nav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
import { AppNav, isActive, NAV_ITEMS } from '@/components/app-nav';

afterEach(cleanup);

describe('AppNav', () => {
  it('has the five entries in order', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['总览', '作品', '选题', '助手', '设置']);
  });
  it('treats project pages as part of 作品', () => {
    expect(isActive('/projects/abc', '/works')).toBe(true);
    expect(isActive('/works', '/')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/settings', '/settings')).toBe(true);
  });
  it('renders a sidebar and a bottom tab bar, marking the current page', () => {
    pathname = '/topics';
    render(<AppNav />);
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(2);
    expect(current.every((a) => a.textContent?.includes('选题'))).toBe(true);
    expect(screen.getByTestId('tabbar').className).toContain('md:hidden');
    expect(screen.getByTestId('sidebar').className).toContain('hidden md:flex');
  });
  it('reserves space for the bottom tab bar', () => {
    render(<AppNav />);
    expect(screen.getByTestId('tabbar-spacer').className).toContain('md:hidden');
  });
});
```

`tests/lib/ui/redirects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../../next.config.js');

describe('old routes', () => {
  it('redirects /retro and /persona permanently', async () => {
    expect(await config.redirects()).toEqual([
      { source: '/retro', destination: '/works?stage=published', permanent: true },
      { source: '/persona', destination: '/settings#persona', permanent: true },
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/app-nav.test.tsx tests/lib/ui/redirects.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/components/app-nav.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Compass, LayoutDashboard, Clapperboard, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/', label: '总览', icon: LayoutDashboard },
  { href: '/works', label: '作品', icon: Clapperboard },
  { href: '/topics', label: '选题', icon: Compass },
  { href: '/assistant', label: '助手', icon: Bot },
  { href: '/settings', label: '设置', icon: Settings },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/works') return pathname.startsWith('/works') || pathname.startsWith('/projects');
  return pathname.startsWith(href);
}

export function AppNav() {
  const pathname = usePathname() ?? '/';
  return (
    <>
      <nav data-testid="sidebar" className="hidden md:flex w-[var(--sidebar-w)] shrink-0 flex-col gap-1 bg-[var(--bg-base)] p-4">
        <div className="mb-4 px-2 font-display text-lg font-bold">MediaPilot</div>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={cn('flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-[15px]', on ? 'bg-[var(--accent-subtle)] font-semibold text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]')}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div data-testid="tabbar-spacer" className="h-[var(--tabbar-h)] md:hidden" aria-hidden />
      <nav data-testid="tabbar" className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--tabbar-h)] items-stretch justify-around bg-[var(--bg-base)] shadow-[0_-1px_0_var(--border-subtle)] md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', on ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]')}>
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

（`tabbar-spacer` 放在 `main` 内容末尾的位置由 layout 决定，见下。）

- [ ] **Step 4: `src/app/layout.tsx` 与重定向**

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppNav } from '@/components/app-nav';

export const metadata: Metadata = {
  title: 'MediaPilot',
  description: '项目 + 编导 agent 的口播出片工作台',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-[100dvh] overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AppNav />
        {/* 手机上底部标签栏是 fixed: main 底部留出同样高度, 内容不被挡 */}
        <main className="min-w-0 flex-1 overflow-hidden pb-[var(--tabbar-h)] md:pb-0">{children}</main>
      </body>
    </html>
  );
}
```

（`AppNav` 里的 `tabbar-spacer` 在 `main` 之外不占位——保留它作为可测的"留空"标记；真正的留空由 `main` 的 `pb-[var(--tabbar-h)] md:pb-0` 完成。Task 8 真机量最后一行不被遮挡。）

`next.config.js`：

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  // 2026-10 改版: 复盘并入「作品 · 已发布」, 定位并入「设置」
  async redirects() {
    return [
      { source: '/retro', destination: '/works?stage=published', permanent: true },
      { source: '/persona', destination: '/settings#persona', permanent: true },
    ];
  },
};

module.exports = nextConfig;
```

删除 `src/app/retro/page.tsx`、`src/app/persona/page.tsx`。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/components/app-nav.tsx src/app/layout.tsx next.config.js src/app/retro src/app/persona tests
git commit -m "feat(ui): 5 项导航(侧栏 + 手机底部标签栏) + /retro、/persona 永久跳转

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 六步判定与作品页

**Files:**
- Create: `src/lib/overview/steps.ts`、`src/components/works/step-dots.tsx`、`src/components/works/work-card.tsx`、`src/app/works/page.tsx`、`src/lib/overview/load.ts`（本任务只放 `loadWorkCards`）
- Test: `tests/lib/overview/steps.test.ts`、`tests/components/works/work-card.test.tsx`

**Interfaces:**
- Produces：
  - `STEP_KEYS = ['topic', 'script', 'recording', 'film', 'publish', 'retro'] as const`；`type StepKey`；`STEP_LABEL: Record<StepKey, string>`（选题 / 脚本 / 口播 / 成片 / 发布 / 复盘）；`STAGE_TEXT: Record<string, string>`（写稿中 / 已定稿 / 已录制 / 成片 / 已发布）
  - `interface StepInput { stage: string; hasBenchmark: boolean; hasScript: boolean; published: boolean; hasRetro: boolean }`
  - `interface StepState { key: StepKey; label: string; done: boolean; current: boolean }`
  - `stepsOf(i: StepInput): StepState[]`；`currentStep(i): StepKey`；`nextActionText(key: StepKey): string`
  - `STAGE_FILTERS = [{ key: 'all', label: '全部' }, { key: 'draft', label: '写稿中' }, { key: 'recording', label: '录制中' }, { key: 'film', label: '成片' }, { key: 'published', label: '已发布' }]`；`filterOf(card: WorkCardData): string`
  - `interface WorkCardData { id: string; title: string; stage: string; steps: StepState[]; durationSec: number | null; center: number | null; views: number | null; updatedAt: string }`
  - `loadWorkCards(db): Promise<WorkCardData[]>`
  - `WorkCard({ card })`、`StepDots({ steps, size? })`

- [ ] **Step 1: 写失败测试**

`tests/lib/overview/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { currentStep, filterOf, nextActionText, stepsOf } from '@/lib/overview/steps';

const base = { stage: 'draft', hasBenchmark: false, hasScript: false, published: false, hasRetro: false };

describe('six steps', () => {
  it('marks done steps by stage, publish and retro', () => {
    const s = stepsOf({ ...base, stage: 'final', hasBenchmark: true, hasScript: true });
    expect(s.map((x) => [x.key, x.done])).toEqual([['topic', true], ['script', true], ['recording', true], ['film', true], ['publish', false], ['retro', false]]);
  });
  it('marks the first unfinished step as current', () => {
    expect(currentStep({ ...base })).toBe('topic');
    expect(currentStep({ ...base, hasScript: true })).toBe('script');
    expect(currentStep({ ...base, stage: 'published', hasScript: true, published: true })).toBe('retro');
    expect(currentStep({ ...base, stage: 'published', hasScript: true, published: true, hasRetro: true })).toBe('retro');
    expect(stepsOf({ ...base, hasScript: true }).filter((x) => x.current)).toHaveLength(1);
  });
  it('says what to do next', () => {
    expect(nextActionText('script')).toBe('下一步：磨稿并定稿');
    expect(nextActionText('publish')).toBe('下一步：发布并关联作品');
  });
  it('maps a card to a stage filter', () => {
    const card = (stage: string, published = false) => ({ id: 'x', title: 't', stage, steps: stepsOf({ ...base, stage, hasScript: true, published }), durationSec: null, center: null, views: null, updatedAt: '' });
    expect(filterOf(card('draft'))).toBe('draft');
    expect(filterOf(card('scripted'))).toBe('recording');
    expect(filterOf(card('recorded'))).toBe('film');
    expect(filterOf(card('final'))).toBe('film');
    expect(filterOf(card('final', true))).toBe('published');
  });
});
```

`tests/components/works/work-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkCard } from '@/components/works/work-card';
import { stepsOf } from '@/lib/overview/steps';

afterEach(cleanup);
const base = { stage: 'final', hasBenchmark: true, hasScript: true, published: false, hasRetro: false };

describe('WorkCard', () => {
  it('shows the prediction before publishing and views after', () => {
    const card = { id: 'p1', title: 'U盘干到品类第一', stage: 'final', steps: stepsOf(base), durationSec: 65, center: 4565, views: null, updatedAt: '2026-09-29T00:00:00.000Z' };
    const { rerender } = render(<WorkCard card={card} />);
    expect(screen.getByText('预测 ~4,565')).toBeTruthy();
    expect(screen.getByText('成片 · 下一步：发布并关联作品')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects/p1');
    rerender(<WorkCard card={{ ...card, steps: stepsOf({ ...base, published: true }), views: 25152 }} />);
    expect(screen.getByText('播放 2.5万')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/overview tests/components/works`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/overview/steps.ts`**

```ts
export const STEP_KEYS = ['topic', 'script', 'recording', 'film', 'publish', 'retro'] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const STEP_LABEL: Record<StepKey, string> = { topic: '选题', script: '脚本', recording: '口播', film: '成片', publish: '发布', retro: '复盘' };
export const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿', recorded: '已录制', final: '成片', published: '已发布' };

export interface StepInput {
  stage: string;
  hasBenchmark: boolean;
  hasScript: boolean;
  published: boolean;
  hasRetro: boolean;
}
export interface StepState {
  key: StepKey;
  label: string;
  done: boolean;
  current: boolean;
}

const ORDER = ['draft', 'scripted', 'recorded', 'final', 'published'];
const atLeast = (stage: string, min: string) => ORDER.indexOf(stage) >= ORDER.indexOf(min);

export function stepsOf(i: StepInput): StepState[] {
  const done: Record<StepKey, boolean> = {
    topic: i.hasBenchmark || i.hasScript,
    script: atLeast(i.stage, 'scripted'),
    recording: atLeast(i.stage, 'recorded'),
    film: atLeast(i.stage, 'final'),
    publish: i.published,
    retro: i.hasRetro,
  };
  const cur = STEP_KEYS.find((k) => !done[k]) ?? 'retro';
  return STEP_KEYS.map((key) => ({ key, label: STEP_LABEL[key], done: done[key], current: key === cur }));
}

export const currentStep = (i: StepInput): StepKey => stepsOf(i).find((s) => s.current)!.key;

const NEXT: Record<StepKey, string> = {
  topic: '下一步：定选题，和编导聊聊这条讲什么',
  script: '下一步：磨稿并定稿',
  recording: '下一步：录口播并上传',
  film: '下一步：在 Claude Code 里出片',
  publish: '下一步：发布并关联作品',
  retro: '下一步：等第 3 天复盘',
};
export const nextActionText = (key: StepKey) => NEXT[key];

export const STAGE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '写稿中' },
  { key: 'recording', label: '录制中' },
  { key: 'film', label: '成片' },
  { key: 'published', label: '已发布' },
] as const;

export interface WorkCardData {
  id: string;
  title: string;
  stage: string;
  steps: StepState[];
  durationSec: number | null;
  center: number | null;
  views: number | null;
  updatedAt: string;
}

export function filterOf(c: WorkCardData): string {
  if (c.steps.find((s) => s.key === 'publish')?.done) return 'published';
  if (c.stage === 'draft') return 'draft';
  if (c.stage === 'scripted') return 'recording';
  return 'film';
}
```

- [ ] **Step 4: 组件与页面**

`src/components/works/step-dots.tsx`:

```tsx
import type { StepState } from '@/lib/overview/steps';
import { cn } from '@/lib/utils';

/** 卡片上的迷你六步条 */
export function StepDots({ steps }: { steps: StepState[] }) {
  return (
    <div className="flex gap-1" aria-label={`进度：${steps.filter((s) => s.done).length}/6`}>
      {steps.map((s) => (
        <span key={s.key} title={s.label} className={cn('h-1.5 flex-1 rounded-full', s.done ? 'bg-[var(--chart)]' : s.current ? 'bg-[var(--accent-border)]' : 'bg-[var(--bg-elevated)]')} />
      ))}
    </div>
  );
}
```

`src/components/works/work-card.tsx`:

```tsx
import Link from 'next/link';
import { fmtViews } from '@/lib/predict/formula';
import { nextActionText, STAGE_TEXT, type WorkCardData } from '@/lib/overview/steps';
import { StepDots } from './step-dots';

export function WorkCard({ card }: { card: WorkCardData }) {
  const cur = card.steps.find((s) => s.current)!;
  const published = card.steps.find((s) => s.key === 'publish')!.done;
  return (
    <Link href={`/projects/${card.id}`} className="card block transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="mb-2 line-clamp-2 text-[15px] font-semibold">{card.title}</div>
      <StepDots steps={card.steps} />
      <div className="mt-2 text-xs text-[var(--text-secondary)]">{`${STAGE_TEXT[card.stage] ?? card.stage} · ${nextActionText(cur.key)}`}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
        {published && card.views !== null && <span className="chip">{`播放 ${fmtViews(card.views)}`}</span>}
        {!published && card.center !== null && <span className="chip">{`预测 ~${card.center.toLocaleString('en-US')}`}</span>}
        {card.durationSec !== null && <span className="tabular-nums">{`约 ${card.durationSec} 秒`}</span>}
        <span className="ml-auto tabular-nums">{new Date(card.updatedAt).toLocaleDateString('zh-CN')}</span>
      </div>
    </Link>
  );
}
```


`src/lib/overview/load.ts`（本任务部分）:

```ts
import type { PrismaClient } from '@prisma/client';
import { toProjectView } from '@/lib/project/view';
import { latestForDisplay } from '@/lib/cli/commands/predict';
import { stepsOf, type WorkCardData } from './steps';

export async function loadWorkCards(db: PrismaClient): Promise<WorkCardData[]> {
  const rows = await db.project.findMany({ orderBy: { updatedAt: 'desc' }, include: { retro: { select: { id: true } }, publishedWorks: { orderBy: { publishedAt: 'desc' }, take: 1 } } });
  const out: WorkCardData[] = [];
  for (const p of rows) {
    const v = toProjectView(p);
    const w = p.publishedWorks[0] ?? null;
    const pred = w ? null : await latestForDisplay(db, p.id);
    out.push({
      id: p.id,
      title: p.title,
      stage: p.stage,
      steps: stepsOf({ stage: p.stage, hasBenchmark: !!p.benchmarkVideoId, hasScript: !!v.script, published: !!w, hasRetro: !!p.retro }),
      durationSec: v.report ? v.report.totalSec : null,
      center: pred?.result.center ?? null,
      views: w ? w.viewCount ?? w.play : null,
      updatedAt: v.updatedAt,
    });
  }
  return out;
}
```

`src/app/works/page.tsx`:

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { loadWorkCards } from '@/lib/overview/load';
import { filterOf, STAGE_FILTERS } from '@/lib/overview/steps';
import { WorkCard } from '@/components/works/work-card';
import { NewProjectButton } from '@/components/project/new-project-button';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function WorksPage({ searchParams }: { searchParams?: { stage?: string; sort?: string } }) {
  const stage = STAGE_FILTERS.some((f) => f.key === searchParams?.stage) ? searchParams!.stage! : 'all';
  const sort = searchParams?.sort === 'predict' ? 'predict' : 'updated';
  const all = await loadWorkCards(prisma);
  let cards = stage === 'all' ? all : all.filter((c) => filterOf(c) === stage);
  if (sort === 'predict') cards = [...cards].sort((a, b) => (b.center ?? -1) - (a.center ?? -1));
  const q = (s: string, so = sort) => `/works?${new URLSearchParams({ ...(s !== 'all' ? { stage: s } : {}), ...(so !== 'updated' ? { sort: so } : {}) })}`;
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold">作品</h1>
        <div className="flex-1" />
        <Link href={q(stage, sort === 'predict' ? 'updated' : 'predict')} className="text-sm text-[var(--accent)]">
          {sort === 'predict' ? '按更新时间' : '按预测排序'}
        </Link>
        <NewProjectButton />
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {STAGE_FILTERS.map((f) => (
          <Link key={f.key} href={q(f.key)} className={cn('chip shrink-0', f.key === stage && 'bg-[var(--accent)] text-[var(--text-on-accent)]')}>
            {`${f.label} ${f.key === 'all' ? all.length : all.filter((c) => filterOf(c) === f.key).length}`}
          </Link>
        ))}
      </div>
      {cards.length === 0 ? (
        <div className="card text-sm text-[var(--text-secondary)]">{all.length === 0 ? '还没有作品。新建一个，和编导聊聊这条讲什么。' : '这个阶段没有作品。'}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-4">
          {cards.map((c) => (
            <WorkCard key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/overview src/components/works src/app/works tests
git commit -m "feat(ui): 作品页(卡片网格 + 阶段筛选 + 按预测排序)与六步判定

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 账号每日快照

**Files:**
- Modify: `prisma/schema.prisma`（spec §6 `AccountDailySnapshot`）、`scripts/collect-douyin.ts`
- Create: `src/lib/account/daily.ts`
- Test: `tests/lib/account/daily.test.ts`

**Interfaces:**
- Produces：`dayKey(d: Date): string`（本机时区 `YYYY-MM-DD`）；`recordDailySnapshot(db, now: Date): Promise<{ day: string }>`；`loadTrend(db, days: number, now: Date): Promise<{ day: string; fans: number | null; likes: number | null; views: number | null }[]>`；`snapshotDays(db): Promise<number>`

- [ ] **Step 1: schema**

追加 spec §6 的 `AccountDailySnapshot`。Run: `npx prisma db push && npm run typecheck` → in sync。

- [ ] **Step 2: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { dayKey, loadTrend, recordDailySnapshot } from '@/lib/account/daily';

function fakeDb(fans: number | null, likes: number | null) {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    douyinMetricSummary: { findUnique: async ({ where }: { where: { metric: string } }) => (/follow/i.test(where.metric) ? (fans === null ? null : { currentCount: fans }) : likes === null ? null : { currentCount: likes }) },
    publishedWork: { aggregate: async () => ({ _count: { _all: 5 }, _sum: { play: 32890 } }) },
    accountDailySnapshot: {
      findUnique: async ({ where }: { where: { day: string } }) => rows.get(where.day) ?? null,
      upsert: async ({ where, create, update }: { where: { day: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        rows.set(where.day, { ...(rows.get(where.day) ?? create), ...(rows.has(where.day) ? update : {}) });
      },
      findMany: async () => [...rows.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))),
    },
  } as unknown as PrismaClient;
  return { db, rows };
}

describe('account daily snapshot', () => {
  it('keys by local date', () => {
    expect(dayKey(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
  it('records fans, likes, works and views', async () => {
    const { db, rows } = fakeDb(410, 2452);
    await recordDailySnapshot(db, new Date(2026, 9, 1, 20));
    expect(rows.get('2026-10-01')).toMatchObject({ day: '2026-10-01', fans: 410, likes: 2452, works: 5, views: 32890 });
  });
  it('overwrites the same day but keeps known numbers', async () => {
    const a = fakeDb(410, 2452);
    await recordDailySnapshot(a.db, new Date(2026, 9, 1, 20));
    const b = { ...a, db: fakeDb(null, 2460).db };
    (b.db as unknown as { accountDailySnapshot: unknown }).accountDailySnapshot = (a.db as unknown as { accountDailySnapshot: unknown }).accountDailySnapshot;
    await recordDailySnapshot(b.db, new Date(2026, 9, 1, 22));
    expect(a.rows.size).toBe(1);
    expect(a.rows.get('2026-10-01')).toMatchObject({ fans: 410, likes: 2460 });
  });
  it('returns the last N days in order', async () => {
    const { db } = fakeDb(410, 2452);
    await recordDailySnapshot(db, new Date(2026, 8, 30, 20));
    await recordDailySnapshot(db, new Date(2026, 9, 1, 20));
    expect((await loadTrend(db, 7, new Date(2026, 9, 1, 21))).map((r) => r.day)).toEqual(['2026-09-30', '2026-10-01']);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/account/daily.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现 `src/lib/account/daily.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { PROFILE_METRICS } from '@/lib/douyin/profile';

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 每晚回采后记一条; 同一天再跑覆盖, 但读不到的数不把已有值覆盖成空 */
export async function recordDailySnapshot(db: PrismaClient, now: Date): Promise<{ day: string }> {
  const day = dayKey(now);
  const [fans, likes, agg] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.followers } }),
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.totalLikes } }),
    db.publishedWork.aggregate({ where: { isPrivate: false }, _count: { _all: true }, _sum: { play: true } }),
  ]);
  const data = {
    ...(fans ? { fans: fans.currentCount } : {}),
    ...(likes ? { likes: likes.currentCount } : {}),
    works: agg._count._all,
    views: agg._sum.play ?? 0,
  };
  await db.accountDailySnapshot.upsert({ where: { day }, create: { day, ...data }, update: data });
  return { day };
}

export async function loadTrend(db: PrismaClient, days: number, now: Date) {
  const since = dayKey(new Date(now.getTime() - (days - 1) * 86400_000));
  const rows = await db.accountDailySnapshot.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } });
  return rows.map((r) => ({ day: r.day, fans: r.fans, likes: r.likes, views: r.views }));
}

export const snapshotDays = (db: PrismaClient) => db.accountDailySnapshot.count();
```

（fake db 的 `findMany` 不按 `where` 过滤——测试只放了 2 天，足够。）

- [ ] **Step 5: 接入回采**

`scripts/collect-douyin.ts` 在"账号资料"那段之后加一段独立 try：

```ts
    // 账号每日快照(总览走势曲线) —— 独立失败
    try {
      const { day } = await recordDailySnapshot(prisma, new Date());
      log(`账号每日快照: ${day}`);
    } catch (e) {
      log(`账号每日快照失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
```

（import `recordDailySnapshot` from `'../src/lib/account/daily'`。）

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add prisma/schema.prisma src/lib/account/daily.ts scripts/collect-douyin.ts tests/lib/account
git commit -m "feat(account): 账号每日快照(每晚回采写一条, 同日覆盖不清空) + 走势读取

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 总览（行动优先仪表盘）

**Files:**
- Create: `src/lib/overview/today.ts`、`src/components/overview/today-panel.tsx`、`metric-cards.tsx`、`trend-chart.tsx`、`works-table.tsx`
- Modify: `src/lib/overview/load.ts`（加 `loadOverview`）、`src/app/page.tsx`（整页重写）
- Delete: `src/components/home/account-card.tsx`、`tests/components/account-card.test.tsx`（回采失败提示改由「今天」承担）
- Test: `tests/lib/overview/today.test.ts`、`tests/components/overview/overview.test.tsx`

**Interfaces:**
- Produces：
  - `interface TodoItem { kind: 'task' | 'link' | 'lesson' | 'note' | 'lag' | 'formula'; text: string; href: string }`
  - `interface InProgressItem { id: string; title: string; steps: StepState[]; next: string; center: number | null; first: boolean }`
  - `buildToday(i: { failingTasks: { hint: string }[]; pendingLinks: { projectId: string; title: string }[]; lessonCandidates: number; pendingNotes: { projectId: string; title: string }[]; lagging: { projectId: string; title: string }[]; formulaProposed: boolean; works: WorkCardData[] }): { todos: TodoItem[]; inProgress: InProgressItem[]; empty: boolean }`
  - `interface WorkRow { id: string; title: string; href: string; external: boolean; views: number | null; hook5s: number | null; avgViewSec: number | null; likeRate: number | null; verdicts: { views: Verdict; hook5s: Verdict; middle: Verdict; like: Verdict } }`
  - `interface OverviewData { todos; inProgress; empty; hits: { author: string; ratio: number | null; topic: string }[]; following: number; metrics: { fans: number | null; fansDelta: number | null; likes: number | null; works: number; views: number; calib: { count: number; avgError: number | null } }; trend: { day: string; fans: number | null; likes: number | null; views: number | null }[]; trendDays: number; works: WorkRow[] }`
  - `loadOverview(db, now): Promise<OverviewData>`
  - 组件：`TodayPanel({ data })`、`MetricCards({ m })`、`TrendChart({ trend, recordedDays })`（客户端，7 / 30 天、粉丝 / 获赞 / 播放切换）、`WorksTable({ rows })`（客户端，表头排序）

- [ ] **Step 1: 写失败测试**

`tests/lib/overview/today.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildToday } from '@/lib/overview/today';
import { stepsOf } from '@/lib/overview/steps';

const card = (id: string, stage: string, center: number | null, published = false) => ({ id, title: id, stage, steps: stepsOf({ stage, hasBenchmark: false, hasScript: true, published, hasRetro: false }), durationSec: 60, center, views: null, updatedAt: '' });
const none = { failingTasks: [], pendingLinks: [], lessonCandidates: 0, pendingNotes: [], lagging: [], formulaProposed: false, works: [] };

describe('today', () => {
  it('lists every kind of todo with a link', () => {
    const t = buildToday({
      ...none,
      failingTasks: [{ hint: '超过 36 小时没有成功对标巡检' }],
      pendingLinks: [{ projectId: 'p1', title: 'U盘' }],
      lessonCandidates: 2,
      pendingNotes: [{ projectId: 'p2', title: 'AI 剪辑' }],
      lagging: [{ projectId: 'p3', title: '新作品' }],
      formulaProposed: true,
    });
    expect(t.todos.map((x) => [x.kind, x.href])).toEqual([
      ['task', '/settings#tasks'],
      ['link', '/projects/p1'],
      ['lesson', '/settings#lessons'],
      ['note', '/projects/p2'],
      ['lag', '/projects/p3'],
      ['formula', '/settings#formula'],
    ]);
    expect(t.todos[2].text).toBe('2 条写法经验等你决定');
  });
  it('orders works in progress by prediction and marks the first only with two or more predictions', () => {
    const one = buildToday({ ...none, works: [card('a', 'final', 3000), card('b', 'draft', null)] });
    expect(one.inProgress.map((x) => [x.id, x.first])).toEqual([['a', false], ['b', false]]);
    const two = buildToday({ ...none, works: [card('a', 'final', 3000), card('b', 'scripted', 5000), card('c', 'final', null, true)] });
    expect(two.inProgress.map((x) => [x.id, x.first])).toEqual([['b', true], ['a', false]]);
  });
  it('shows the empty day prompt when there is nothing to do', () => {
    expect(buildToday(none)).toMatchObject({ todos: [], inProgress: [], empty: true });
  });
});
```

`tests/components/overview/overview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetricCards } from '@/components/overview/metric-cards';
import { TrendChart } from '@/components/overview/trend-chart';
import { WorksTable } from '@/components/overview/works-table';

afterEach(cleanup);

describe('overview widgets', () => {
  it('handles missing account numbers', () => {
    render(<MetricCards m={{ fans: null, fansDelta: null, likes: null, works: 0, views: 0, calib: { count: 0, avgError: null } }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
  it('shows the calibration line once checked', () => {
    render(<MetricCards m={{ fans: 410, fansDelta: 1, likes: 2452, works: 5, views: 32890, calib: { count: 3, avgError: 1.6 } }} />);
    expect(screen.getByText('410')).toBeTruthy();
    expect(screen.getByText('较昨天 +1')).toBeTruthy();
    expect(screen.getByText('对过 3 次账 · 平均偏差 1.6 倍')).toBeTruthy();
  });
  it('waits for 7 days before drawing the trend', () => {
    render(<TrendChart trend={[{ day: '2026-10-01', fans: 410, likes: 2452, views: 32890 }]} recordedDays={1} />);
    expect(screen.getByText('已记录 1 天，满 7 天显示曲线')).toBeTruthy();
  });
  it('draws a line once there are 7 days and switches series', () => {
    const trend = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-0${i + 1}`, fans: 400 + i, likes: 2400 + i, views: 30000 + i * 100 }));
    const { container } = render(<TrendChart trend={trend} recordedDays={7} />);
    expect(container.querySelector('svg path')).toBeTruthy();
    fireEvent.click(screen.getByText('播放'));
    expect(screen.getByText('30,600')).toBeTruthy();
  });
  it('sorts the works table by a column', () => {
    const row = (id: string, views: number) => ({ id, title: id, href: `/projects/${id}`, external: false, views, hook5s: 0.4, avgViewSec: 10, likeRate: 0.02, verdicts: { views: 'even', hook5s: 'even', middle: 'even', like: 'even' } as const });
    render(<WorksTable rows={[row('小', 100), row('大', 9000)]} />);
    fireEvent.click(screen.getByText('播放'));
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links[0]).toContain('大');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/overview tests/components/overview`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/overview/today.ts`**

```ts
import { nextActionText, type StepState, type WorkCardData } from './steps';

export interface TodoItem {
  kind: 'task' | 'link' | 'lesson' | 'note' | 'lag' | 'formula';
  text: string;
  href: string;
}
export interface InProgressItem {
  id: string;
  title: string;
  steps: StepState[];
  next: string;
  center: number | null;
  first: boolean;
}

export function buildToday(i: {
  failingTasks: { hint: string }[];
  pendingLinks: { projectId: string; title: string }[];
  lessonCandidates: number;
  pendingNotes: { projectId: string; title: string }[];
  lagging: { projectId: string; title: string }[];
  formulaProposed: boolean;
  works: WorkCardData[];
}): { todos: TodoItem[]; inProgress: InProgressItem[]; empty: boolean } {
  const todos: TodoItem[] = [
    ...i.failingTasks.map((t): TodoItem => ({ kind: 'task', text: t.hint, href: '/settings#tasks' })),
    ...i.pendingLinks.map((p): TodoItem => ({ kind: 'link', text: `「${p.title}」有一条作品等你确认`, href: `/projects/${p.projectId}` })),
    ...(i.lessonCandidates ? [{ kind: 'lesson' as const, text: `${i.lessonCandidates} 条写法经验等你决定`, href: '/settings#lessons' }] : []),
    ...i.pendingNotes.map((p): TodoItem => ({ kind: 'note', text: `「${p.title}」要不要存进 Obsidian`, href: `/projects/${p.projectId}` })),
    ...i.lagging.map((p): TodoItem => ({ kind: 'lag', text: `「${p.title}」比预期落后`, href: `/projects/${p.projectId}` })),
    ...(i.formulaProposed ? [{ kind: 'formula' as const, text: '预测公式有一条调整建议', href: '/settings#formula' }] : []),
  ];
  const active = i.works
    .filter((w) => !w.steps.find((s) => s.key === 'publish')!.done)
    .sort((a, b) => (b.center ?? -1) - (a.center ?? -1));
  const predicted = active.filter((w) => w.center !== null).length;
  const inProgress = active.map((w, idx): InProgressItem => {
    const cur = w.steps.find((s) => s.current)!;
    return { id: w.id, title: w.title, steps: w.steps, next: nextActionText(cur.key), center: w.center, first: idx === 0 && predicted >= 2 && w.center !== null };
  });
  return { todos, inProgress, empty: todos.length === 0 && inProgress.length === 0 };
}
```

- [ ] **Step 4: `loadOverview`（追加到 `src/lib/overview/load.ts`）**

```ts
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';
import { buildAccountSummary } from '@/lib/account/summary';
import { findCandidate } from '@/lib/retro/match';
import { findLagging } from '@/lib/predict/lag';
import { loadTrend, snapshotDays } from '@/lib/account/daily';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { computeBaseline, metricValues, verdictOf, type Verdict } from '@/lib/retro/diagnose';
import { toMetricSet } from '@/lib/retro/generate';
import { median } from '@/lib/benchmark/rules';
import { buildToday, type InProgressItem, type TodoItem } from './today';

export interface WorkRow {
  id: string;
  title: string;
  href: string;
  external: boolean;
  views: number | null;
  hook5s: number | null;
  avgViewSec: number | null;
  likeRate: number | null;
  verdicts: { views: Verdict; hook5s: Verdict; middle: Verdict; like: Verdict };
}

export interface OverviewData {
  todos: TodoItem[];
  inProgress: InProgressItem[];
  empty: boolean;
  hits: { author: string; ratio: number | null; topic: string }[];
  following: number;
  metrics: { fans: number | null; fansDelta: number | null; likes: number | null; works: number; views: number; calib: { count: number; avgError: number | null } };
  trend: { day: string; fans: number | null; likes: number | null; views: number | null }[];
  trendDays: number;
  works: WorkRow[];
}

export async function loadOverview(db: PrismaClient, now: Date): Promise<OverviewData> {
  const [collect, scan] = await Promise.all([readCollectStatus(now), readScanStatus(now)]);
  const sum = await buildAccountSummary(db, collect, scan);
  const works = await loadWorkCards(db);
  const finals = await db.project.findMany({ where: { stage: 'final' }, select: { id: true, title: true } });
  const pendingLinks: { projectId: string; title: string }[] = [];
  for (const p of finals) if (await findCandidate(db, p.id)) pendingLinks.push({ projectId: p.id, title: p.title });
  const notes = await db.noteProposal.findMany({ where: { status: 'pending' }, include: { project: { select: { title: true } } } });
  const lagging = await findLagging(db, now).catch(() => []);
  const today = buildToday({
    failingTasks: [collect, scan].filter((s) => s.state !== 'ok'),
    pendingLinks,
    lessonCandidates: await db.writingLesson.count({ where: { status: 'candidate' } }),
    pendingNotes: notes.map((n) => ({ projectId: n.projectId, title: n.project.title })),
    lagging: lagging.map((l) => ({ projectId: l.projectId, title: l.title })),
    formulaProposed: !!(await db.predictionFormula.findFirst({ where: { status: 'proposed' } })),
    works,
  });

  const hitRows = await db.benchmarkVideo.findMany({ where: { hitAt: { gte: new Date(now.getTime() - 86400_000) }, status: { not: 'ignored' } }, include: { account: true }, orderBy: { ratio: 'desc' }, take: 3 });
  const hits = hitRows.map((h) => {
    const a = AnalysisSchema.safeParse(h.analysis);
    return { author: h.account.nickname, ratio: h.ratio, topic: a.success ? a.data.topic : h.desc.replace(/#\S+/g, '').trim().slice(0, 24) };
  });

  const checks = await db.predictionCheck.findMany({ select: { viewRatio: true } });
  const ratios = checks.map((c) => c.viewRatio).filter((r): r is number => r !== null && r > 0);
  const avgError = ratios.length ? Math.round(Math.exp(ratios.reduce((s, r) => s + Math.abs(Math.log(r)), 0) / ratios.length) * 10) / 10 : null;

  const pub = await db.publishedWork.findMany({ where: { isPrivate: false }, orderBy: { publishedAt: 'desc' } });
  const sets = pub.map(toMetricSet);
  const base = computeBaseline(sets);
  const viewsList = pub.map((w) => w.viewCount ?? w.play).filter((v): v is number => v !== null && v > 0);
  const viewBase = viewsList.length >= 3 ? median(viewsList.slice(0, 10)) : null;
  const rows: WorkRow[] = pub.map((w, i) => {
    const v = metricValues(sets[i]);
    const views = w.viewCount ?? w.play;
    return {
      id: w.id,
      title: (w.title || w.caption || '').slice(0, 40) || '（无标题）',
      href: w.projectId ? `/projects/${w.projectId}` : w.url,
      external: !w.projectId,
      views,
      hook5s: v.hook5s,
      avgViewSec: v.middle,
      likeRate: v.like,
      verdicts: {
        views: verdictOf('like', views, viewBase),
        hook5s: verdictOf('hook5s', v.hook5s, base.medians.hook5s ?? null),
        middle: verdictOf('middle', v.middle, base.medians.middle ?? null),
        like: verdictOf('like', v.like, base.medians.like ?? null),
      },
    };
  });

  return {
    ...today,
    hits,
    following: await db.benchmarkAccount.count({ where: { status: 'following' } }),
    metrics: { fans: sum.fans, fansDelta: sum.fansDelta, likes: sum.likes, works: sum.publicWorks, views: sum.publicPlay, calib: { count: ratios.length, avgError } },
    trend: await loadTrend(db, 30, now),
    trendDays: await snapshotDays(db),
    works: rows,
  };
}
```

（`verdictOf('like', …)` 用于播放量：同为"越高越好"，阈值 20%。）

- [ ] **Step 5: 组件**

`src/components/overview/metric-cards.tsx`:

```tsx
import { fmtViews } from '@/lib/predict/formula';

const Num = ({ v }: { v: string }) => <div className="font-display text-[28px] font-bold leading-tight">{v}</div>;

export function MetricCards({ m }: { m: { fans: number | null; fansDelta: number | null; likes: number | null; works: number; views: number; calib: { count: number; avgError: number | null } } }) {
  const n = (x: number | null) => (x === null ? '—' : x.toLocaleString('en-US'));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <div className="card">
        <div className="t-label">粉丝</div>
        <Num v={n(m.fans)} />
        {m.fansDelta ? <div className={`text-xs ${m.fansDelta > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{`较昨天 ${m.fansDelta > 0 ? '+' : ''}${m.fansDelta}`}</div> : null}
      </div>
      <div className="card">
        <div className="t-label">获赞</div>
        <Num v={n(m.likes)} />
      </div>
      <div className="card">
        <div className="t-label">公开作品 · 播放合计</div>
        <Num v={m.works ? `${m.works} · ${fmtViews(m.views)}` : '—'} />
      </div>
      <div className="card">
        <div className="t-label">预测准度</div>
        <Num v={m.calib.avgError === null ? '—' : `${m.calib.avgError} 倍`} />
        <div className="text-xs text-[var(--text-tertiary)]">{m.calib.count ? `对过 ${m.calib.count} 次账 · 平均偏差 ${m.calib.avgError} 倍` : '还没对过账'}</div>
      </div>
    </div>
  );
}
```

（测试里"对过 3 次账 · 平均偏差 1.6 倍"与大数字"1.6 倍"同时出现——`getByText` 精确匹配整段文字，不冲突。）

`src/components/overview/trend-chart.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

type Point = { day: string; fans: number | null; likes: number | null; views: number | null };
const SERIES = [
  { key: 'fans', label: '粉丝' },
  { key: 'likes', label: '获赞' },
  { key: 'views', label: '播放' },
] as const;
const MIN_DAYS = 7;

export function TrendChart({ trend, recordedDays }: { trend: Point[]; recordedDays: number }) {
  const [series, setSeries] = useState<(typeof SERIES)[number]['key']>('fans');
  const [range, setRange] = useState<7 | 30>(7);
  const pts = trend.slice(-range).map((p) => ({ day: p.day, v: p[series] })).filter((p): p is { day: string; v: number } => p.v !== null);
  const head = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="t-label mr-auto">账号走势</div>
      {SERIES.map((s) => (
        <button key={s.key} className={cn('chip', series === s.key && 'bg-[var(--accent)] text-[var(--text-on-accent)]')} onClick={() => setSeries(s.key)}>
          {s.label}
        </button>
      ))}
      {[7, 30].map((r) => (
        <button key={r} className={cn('chip', range === r && 'bg-[var(--accent-subtle)] text-[var(--accent)]')} onClick={() => setRange(r as 7 | 30)}>
          {`${r} 天`}
        </button>
      ))}
    </div>
  );
  if (recordedDays < MIN_DAYS || pts.length < 2)
    return (
      <div className="card">
        {head}
        <div className="flex h-40 items-center justify-center rounded-[var(--r-md)] bg-[var(--bg-inset)] text-sm text-[var(--text-secondary)]">{`已记录 ${recordedDays} 天，满 ${MIN_DAYS} 天显示曲线`}</div>
      </div>
    );
  const W = 600;
  const H = 160;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, H - 12 - ((p.v - lo) / span) * (H - 24)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="card">
      {head}
      <div className="mb-1 font-display text-xl font-bold">{last.v.toLocaleString('en-US')}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${SERIES.find((s) => s.key === series)!.label}近 ${range} 天`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke="var(--chart)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[var(--text-tertiary)]">
        <span>{pts[0].day.slice(5)}</span>
        <span>{last.day.slice(5)}</span>
      </div>
    </div>
  );
}
```

`src/components/overview/works-table.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkRow } from '@/lib/overview/load';
import { fmtViews } from '@/lib/predict/formula';
import { cn } from '@/lib/utils';

const COLS = [
  { key: 'views', label: '播放', fmt: (v: number) => fmtViews(v), verdict: 'views' },
  { key: 'hook5s', label: '5秒完播', fmt: (v: number) => `${Math.round(v * 100)}%`, verdict: 'hook5s' },
  { key: 'avgViewSec', label: '平均观看', fmt: (v: number) => `${v.toFixed(1)} 秒`, verdict: 'middle' },
  { key: 'likeRate', label: '点赞率', fmt: (v: number) => `${(v * 100).toFixed(1)}%`, verdict: 'like' },
] as const;
const TONE: Record<string, string> = { good: 'text-[var(--success)]', bad: 'text-[var(--danger)]' };

export function WorksTable({ rows }: { rows: WorkRow[] }) {
  const [sort, setSort] = useState<(typeof COLS)[number]['key'] | null>(null);
  if (!rows.length) return <div className="card text-sm text-[var(--text-secondary)]">发布第一条后这里会出现对比</div>;
  const sorted = sort ? [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1)) : rows;
  const max = Math.max(...rows.map((r) => r.views ?? 0), 1);
  return (
    <div className="card overflow-x-auto">
      <div className="t-label mb-2">作品表现对比</div>
      <table className="w-full min-w-[520px] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-[var(--text-tertiary)]">
            <th className="py-2 font-normal">作品</th>
            {COLS.map((c) => (
              <th key={c.key} className="py-2 font-normal">
                <button className={cn(sort === c.key && 'font-semibold text-[var(--accent)]')} onClick={() => setSort(c.key)}>
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-subtle)]">
              <td className="max-w-[220px] py-2 pr-3">
                <Link href={r.href} target={r.external ? '_blank' : undefined} className="block truncate hover:text-[var(--accent)]">
                  {r.title}
                </Link>
                <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-elevated)]">
                  <div className="h-1.5 rounded-full bg-[var(--chart)]" style={{ width: `${((r.views ?? 0) / max) * 100}%` }} />
                </div>
              </td>
              {COLS.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} className={cn('py-2 pr-3', TONE[r.verdicts[c.verdict]])}>
                    {v === null ? '—' : c.fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/components/overview/today-panel.tsx`:

```tsx
import Link from 'next/link';
import type { OverviewData } from '@/lib/overview/load';
import { StepDots } from '@/components/works/step-dots';
import { NewProjectButton } from '@/components/project/new-project-button';

export function TodayPanel({ data }: { data: OverviewData }) {
  return (
    <section className="card-hero">
      <h2 className="mb-3 text-[15px] font-semibold">今天</h2>
      {data.empty ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
          今天没有要处理的，去写一条？
          <NewProjectButton />
        </div>
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-3 md:overflow-visible">
          {data.todos.length > 0 && (
            <div className="card min-w-[260px] snap-start">
              <div className="t-label mb-2">要你处理</div>
              <ul className="space-y-2 text-sm">
                {data.todos.map((t, i) => (
                  <li key={i}>
                    <Link href={t.href} className={t.kind === 'task' || t.kind === 'lag' ? 'text-[var(--warning)]' : 'hover:text-[var(--accent)]'}>
                      {`${t.text} →`}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.inProgress.slice(0, 3).map((w) => (
            <Link key={w.id} href={`/projects/${w.id}`} className="card min-w-[260px] snap-start">
              <div className="mb-1 flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold">{w.title}</span>
                {w.first && <span className="chip shrink-0 bg-[var(--accent)] text-[var(--text-on-accent)]">先发这条</span>}
              </div>
              <StepDots steps={w.steps} />
              <div className="mt-2 text-xs text-[var(--text-secondary)]">{w.next}</div>
              {w.center !== null && <div className="mt-1 text-xs text-[var(--text-tertiary)]">{`预测 ~${w.center.toLocaleString('en-US')}`}</div>}
            </Link>
          ))}
          <Link href="/topics" className="card min-w-[260px] snap-start">
            <div className="t-label mb-2">今日对标爆款</div>
            {data.hits.length ? (
              <ul className="space-y-1 text-sm">
                {data.hits.map((h, i) => (
                  <li key={i} className="truncate">{`${h.author}（平时 ${h.ratio ?? '?'} 倍）${h.topic}`}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-[var(--text-secondary)]">
                <span className="font-display text-[28px] font-bold text-[var(--text-primary)]">0</span>
                <div>{`关注 ${data.following} 个账号 · 去加对标 →`}</div>
              </div>
            )}
          </Link>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: 总览页 `src/app/page.tsx`（整页替换）**

```tsx
import { prisma } from '@/lib/prisma';
import { loadOverview } from '@/lib/overview/load';
import { TodayPanel } from '@/components/overview/today-panel';
import { MetricCards } from '@/components/overview/metric-cards';
import { TrendChart } from '@/components/overview/trend-chart';
import { WorksTable } from '@/components/overview/works-table';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const data = await loadOverview(prisma, new Date());
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-5 text-[22px] font-bold">总览</h1>
      <div className="space-y-4">
        <TodayPanel data={data} />
        <MetricCards m={data.metrics} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TrendChart trend={data.trend} recordedDays={data.trendDays} />
          <WorksTable rows={data.works} />
        </div>
      </div>
    </div>
  );
}
```

删除 `src/components/home/account-card.tsx`、`tests/components/account-card.test.tsx`（回采失败提示改由「今天」显示，原首页"按预测排序"已在作品页）。

- [ ] **Step 7: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（改了 schema、加了页面 → 重启 dev）：`/` 显示今天、指标、走势（"已记录 N 天"）、作品对比；375 宽下单列、今天横向滑动。

```bash
git add src/lib/overview src/components/overview src/app/page.tsx src/components/home tests
git commit -m "feat(ui): 总览改为行动优先仪表盘(今天 / 指标 / 走势 / 作品对比)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 作品工作区（步骤条 + 编导抽屉）

**Files:**
- Create: `src/components/project/step-bar.tsx`、`src/components/project/topic-step.tsx`、`src/components/project/chat-drawer.tsx`
- Modify: `src/lib/project/load.ts`（bundle 加 `reference`、`published`、`hasRetro`）、`src/components/project/project-workspace.tsx`、`src/components/project/publish-pane.tsx`（`section` 参数）、`src/app/projects/[id]/page.tsx`
- Test: `tests/components/project-workspace.test.tsx`（改 tab 断言 + 新用例）、`tests/components/chat-drawer.test.tsx`

**Interfaces:**
- Consumes：`stepsOf`、`StepKey`、`STEP_LABEL`（Task 3）、`Reference`（`src/lib/benchmark/adopt.ts`）
- Produces：
  - `ProjectBundle` 加 `reference: Reference | null; published: boolean; hasRetro: boolean`
  - `StepBar({ steps, active, onSelect })`：`role="tablist"`，每步 `role="tab"`、`aria-selected`，可访问名为中文步名
  - `TopicStep({ reference })`
  - `ChatDrawer({ open, onOpenChange, unread, children })`：关时右下角按钮「和编导聊」（有未读带圆点）；开时电脑右侧抽屉（`md:w-[var(--drawer-w)]`）、手机底部面板（`h-[85dvh]`）；内容始终挂载（关闭不清空对话）
  - `PublishPane` 新参数 `section?: 'publish' | 'retro'`（不传 = 两部分都显示）
  - `ProjectWorkspace` 新增 props：`initialReference`、`initialPublished`、`initialHasRetro`

- [ ] **Step 1: 写失败测试**

`tests/components/chat-drawer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatDrawer } from '@/components/project/chat-drawer';

afterEach(cleanup);

describe('ChatDrawer', () => {
  it('shows a button when closed and keeps the chat mounted', () => {
    const onOpenChange = vi.fn();
    render(
      <ChatDrawer open={false} onOpenChange={onOpenChange} unread>
        <div>对话内容</div>
      </ChatDrawer>,
    );
    expect(screen.getByText('对话内容')).toBeTruthy();
    expect(screen.getByLabelText('有新消息')).toBeTruthy();
    fireEvent.click(screen.getByText('和编导聊'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
  it('closes from the panel header', () => {
    const onOpenChange = vi.fn();
    render(
      <ChatDrawer open onOpenChange={onOpenChange} unread={false}>
        <div>对话内容</div>
      </ChatDrawer>,
    );
    fireEvent.click(screen.getByLabelText('收起对话'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

`tests/components/project-workspace.test.tsx`：
- 把 `screen.getByRole('tab', { name: '② 口播' })` 改为 `screen.getByRole('tab', { name: '口播' })`。
- 在 `describe` 里追加：

```tsx
  it('shows six steps and starts on the current one', () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't', stage: 'scripted' })} initialMessages={[]} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/^✓\s*/, ''))).toEqual(['选题', '脚本', '口播', '成片', '发布', '复盘']);
    expect(screen.getByRole('tab', { name: '口播' }).getAttribute('aria-selected')).toBe('true');
  });
  it('opens the drawer once per new notice', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const card = { id: 'mNote', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => ({
      json: async () => ({
        success: true,
        data: url.startsWith('/api/notes/proposals/')
          ? { id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/t.md', content: '# t', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z' }
          : init?.method === 'PATCH'
            ? toProjectView({ ...base, title: 't', stage: 'scripted' })
            : { project: toProjectView({ ...base, title: 't', stage: 'scripted' }), messages: [card] },
      }),
    })));
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} />);
    expect(screen.queryByLabelText('收起对话')).toBeNull();
    fireEvent.click(screen.getByText('定稿'));
    await waitFor(() => expect(screen.getByLabelText('收起对话')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('收起对话'));
    // 同一条通知不会因为重新渲染再弹开
    fireEvent.click(screen.getByRole('tab', { name: '脚本' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText('收起对话')).toBeNull();
  });
```

（第二个用例：定稿后刷新带来新通知 → 抽屉展开；收起后再重渲染不会重复弹开。注意 `ChatDrawer` 收起时抽屉 DOM 仍在但 `aria-hidden`，`收起对话` 按钮必须在收起时不渲染或不可被 `getByLabelText` 找到——实现时收起状态下不渲染头部按钮。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/chat-drawer.test.tsx tests/components/project-workspace.test.tsx`
Expected: FAIL。

- [ ] **Step 3: bundle 字段**

`src/lib/project/load.ts`：`ProjectBundle` 加三字段；`loadProjectBundle` 里并行查询加 `loadReference(db, p.benchmarkVideoId ?? null)`、`db.publishedWork.count({ where: { projectId: id } })`、`db.retro.findUnique({ where: { projectId: id }, select: { id: true } })`，返回 `reference`、`published: count > 0`、`hasRetro: !!retro`。

`src/app/projects/[id]/page.tsx`：给 `ProjectWorkspace` 传 `initialReference={bundle.reference} initialPublished={bundle.published} initialHasRetro={bundle.hasRetro}`。

- [ ] **Step 4: 组件**

`src/components/project/step-bar.tsx`:

```tsx
'use client';

import type { StepKey, StepState } from '@/lib/overview/steps';
import { cn } from '@/lib/utils';

export function StepBar({ steps, active, onSelect }: { steps: StepState[]; active: StepKey; onSelect: (k: StepKey) => void }) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
      {steps.map((s) => (
        <button
          key={s.key}
          role="tab"
          aria-selected={active === s.key}
          aria-label={s.label}
          onClick={() => onSelect(s.key)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-sm',
            active === s.key ? 'bg-[var(--accent)] font-semibold text-[var(--text-on-accent)]' : s.done ? 'bg-[var(--accent-border)] text-[var(--accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
          )}
        >
          {s.done && active !== s.key ? `✓ ${s.label}` : s.label}
        </button>
      ))}
    </div>
  );
}
```

`src/components/project/topic-step.tsx`:

```tsx
import type { Reference } from '@/lib/benchmark/adopt';

export function TopicStep({ reference }: { reference: Reference | null }) {
  if (!reference) return <div className="card text-sm text-[var(--text-secondary)]">这条没有对标作品。选题和角度在右下角和编导聊。</div>;
  const a = reference.analysis;
  return (
    <div className="space-y-3">
      <div className="card">
        <div className="t-label">对标作品</div>
        <div className="mt-1 text-[15px] font-semibold">{`${reference.author}${reference.ratio ? `（点赞是他平时的 ${reference.ratio} 倍）` : ''}`}</div>
        {a && (
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="t-label">选题</dt><dd>{a.topic}</dd></div>
            <div><dt className="t-label">{`开头钩子（${a.hook.type}）`}</dt><dd>{a.hook.quote}</dd></div>
            <div><dt className="t-label">标题写法</dt><dd>{a.titlePattern}</dd></div>
            <div><dt className="t-label">建议角度</dt><dd>{a.myAngle}</dd></div>
          </dl>
        )}
      </div>
      {reference.transcript && (
        <details className="card text-sm">
          <summary className="cursor-pointer text-[var(--text-secondary)]">逐字稿</summary>
          <p className="mt-2 whitespace-pre-wrap leading-7">{reference.transcript}</p>
        </details>
      )}
    </div>
  );
}
```

`src/components/project/chat-drawer.tsx`:

```tsx
'use client';

import { MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 编导对话: 关时右下角按钮, 开时电脑右侧抽屉 / 手机底部面板; 内容始终挂载, 收起不清空 */
export function ChatDrawer({ open, onOpenChange, unread, children }: { open: boolean; onOpenChange: (v: boolean) => void; unread: boolean; children: React.ReactNode }) {
  return (
    <>
      {!open && (
        <button className="btn-primary fixed bottom-[calc(var(--tabbar-h)+16px)] right-4 z-30 shadow-[var(--shadow-pop)] md:bottom-6 md:right-6" onClick={() => onOpenChange(true)}>
          <MessageCircle size={16} />
          和编导聊
          {unread && <span aria-label="有新消息" className="ml-1 h-2 w-2 rounded-full bg-[var(--danger)]" />}
        </button>
      )}
      <aside
        aria-hidden={!open}
        className={cn(
          'fixed z-40 flex flex-col bg-[var(--bg-base)] shadow-[var(--shadow-pop)] transition-transform',
          'inset-x-0 bottom-0 h-[85dvh] rounded-t-[var(--r-xl)] md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-[var(--drawer-w)] md:rounded-none',
          open ? 'translate-y-0 md:translate-x-0' : 'pointer-events-none translate-y-full md:translate-x-full md:translate-y-0',
        )}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="t-label">编导</span>
          {open && (
            <button aria-label="收起对话" className="rounded-full p-1 hover:bg-[var(--bg-surface-hover)]" onClick={() => onOpenChange(false)}>
              <X size={18} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </>
  );
}
```

- [ ] **Step 5: 工作区改造（`src/components/project/project-workspace.tsx`）**

- props 加 `initialReference?: Reference | null; initialPublished?: boolean; initialHasRetro?: boolean`（默认 `null / false / false`）；`refresh()` 读到的 `j.data.reference / published / hasRetro` 同步到 state。
- 删除 `TABS` 与 `Tab` 类型；`const steps = stepsOf({ stage: project.stage, hasBenchmark: !!reference, hasScript: !!project.script, published, hasRetro })`；`const [tab, setTab] = useState<StepKey>(() => currentStep(…初始值…))`。原转写完成切到口播的逻辑改为 `setTab('recording')`。
- 头部：标题输入保留；下面 `<StepBar steps={steps} active={tab} onSelect={setTab} />`。
- 内容区：`<div className="mx-auto w-full max-w-[820px] px-4 py-5 md:px-6">`，按 `tab` 渲染：`topic → <TopicStep reference={reference} />`；`script → ScriptPane`；`recording → RecordingPane`；`film → FilmPane`；`publish → <PublishPane section="publish" … />`；`retro → <PublishPane section="retro" … />`。
- 抽屉：

```tsx
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const seenNotices = useRef(new Set<string>());
  // 新通知(任务完成 / 存笔记卡片 / 预测完成)到来时展开一次; 同一条不重复弹
  useEffect(() => {
    const fresh = notices.filter((n) => !seenNotices.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seenNotices.current.add(n.id));
    setChatOpen(true);
  }, [notices]);
```

  `onAskEditor` 里加 `setChatOpen(true)`；`ChatPanel` 的 `onTurnStart` 里加 `setChatOpen(true)`；`onTurnEnd` 里若抽屉关着则 `setUnread(true)`；`setChatOpen(true)` 时清 `unread`。原右侧 `<div className="h-[45%] … md:w-[36%]">` 包裹的 `ChatPanel` 换成 `<ChatDrawer open={chatOpen} onOpenChange={(v) => { setChatOpen(v); if (v) setUnread(false); }} unread={unread}>…ChatPanel…</ChatDrawer>`。
- 电脑上抽屉打开时内容让位：外层内容容器加 `className={cn('…', chatOpen && 'md:pr-[var(--drawer-w)]')}`。

`publish-pane.tsx`：props 加 `section?: 'publish' | 'retro'`；`section === 'retro'` 时只渲染 `PredictionSummary` 与「复盘」区块（没关联作品时显示"发布并关联作品后，第 3 天自动复盘"）；`section === 'publish'` 时只渲染「发布文案」与「发布的作品」；不传时两者都渲染（原测试不变）。

- [ ] **Step 6: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：U盘项目：步骤条停在"发布"；六步都能切；「和编导聊」打开右侧抽屉、内容区让位；375 宽下抽屉从底部滑出；脚本页点「预测」完成后抽屉自动展开显示通知。

```bash
git add src/lib/project src/components/project src/app/projects tests
git commit -m "feat(ui): 作品工作区六步步骤条(新增选题、复盘两步) + 可收起的编导抽屉(新通知自动展开一次)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 设置页收拢

**Files:**
- Create: `src/components/settings/lessons-card.tsx`
- Modify: `src/app/settings/page.tsx`
- Delete: `src/components/retro/retro-view.tsx`
- Test: `tests/components/settings/lessons-card.test.tsx`

**Interfaces:**
- Produces：`LessonsCard()`（读 `/api/lessons`，用 `LessonCard` 渲染，空时说明）；设置页锚点 `persona / models / obsidian / tasks / lessons / formula / health`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { LessonsCard } from '@/components/settings/lessons-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LessonsCard', () => {
  it('explains the library when empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: [] }) })));
    render(<LessonsCard />);
    await waitFor(() => expect(screen.getByText(/还没有写法经验/)).toBeTruthy());
    expect(screen.getByText('写法库')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/settings/lessons-card.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/components/settings/lessons-card.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LessonView } from '@/lib/retro/view';
import { LessonCard } from '@/components/retro/lesson-card';

export function LessonsCard() {
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/lessons').then((r) => r.json()).catch(() => ({ success: false }));
    setLessons(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card">
      <h3 className="mb-1 text-[15px] font-semibold">写法库</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">复盘里编导提的经验，采纳后编导写稿都会遵守（生效的最多 10 条）。</p>
      {lessons === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : lessons.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">还没有写法经验。发布后的复盘里，编导提的经验你采纳后会出现在这里。</p>
      ) : (
        <div className="space-y-2">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </section>
  );
}
```

`src/app/settings/page.tsx`:

```tsx
import { prisma } from '@/lib/prisma';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';
import { PersonaEditor } from '@/components/persona/persona-editor';
import { ModelsCard } from '@/components/settings/models-card';
import { HealthPanel } from '@/components/settings/health-panel';
import { NightlyTasks } from '@/components/settings/nightly-tasks';
import { ObsidianCard } from '@/components/settings/obsidian-card';
import { LessonsCard } from '@/components/settings/lessons-card';
import { FormulaCard } from '@/components/retro/formula-card';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'persona', label: '账号定位' },
  { id: 'models', label: '模型' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'tasks', label: '每晚任务' },
  { id: 'lessons', label: '写法库' },
  { id: 'formula', label: '预测公式' },
  { id: 'health', label: '依赖体检' },
];

export default async function SettingsPage() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const parsed = row ? PersonaSchema.safeParse(row) : null;
  const persona = parsed?.success ? parsed.data : EMPTY_PERSONA;
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-3 text-[22px] font-bold">设置</h1>
      <nav className="sticky top-0 z-10 -mx-4 mb-4 flex gap-2 overflow-x-auto bg-[var(--bg-canvas)] px-4 py-2 md:-mx-8 md:px-8">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="chip shrink-0">{s.label}</a>
        ))}
      </nav>
      <div className="max-w-3xl space-y-4">
        <section id="persona" className="card scroll-mt-16">
          <h3 className="mb-3 text-[15px] font-semibold">账号定位</h3>
          {parsed !== null && !parsed.success && <p className="mb-3 text-sm text-[var(--warning)]">旧档案格式不完整，已按空白显示。保存会覆盖旧档案。</p>}
          <PersonaEditor initial={persona} />
        </section>
        <div id="models" className="scroll-mt-16"><ModelsCard /></div>
        <div id="obsidian" className="scroll-mt-16"><ObsidianCard /></div>
        <div id="tasks" className="scroll-mt-16"><NightlyTasks /></div>
        <div id="lessons" className="scroll-mt-16"><LessonsCard /></div>
        <div id="formula" className="scroll-mt-16 space-y-2">
          <FormulaCard onChanged={() => {}} />
        </div>
        <div id="health" className="scroll-mt-16"><HealthPanel /></div>
      </div>
    </div>
  );
}
```

（`FormulaCard` 没有建议时渲染为空——在其外层加一句说明：把 `#formula` 区块改为 `<section id="formula" className="card scroll-mt-16"><h3 …>预测公式</h3><p className="mb-2 text-xs text-[var(--text-secondary)]">同一项连续 3 次往同一方向偏、并且回测更准时，这里会出现调整建议。</p><FormulaCard onChanged={() => {}} /></section>`。）

删除 `src/components/retro/retro-view.tsx`（已发布列表由作品页「已发布」筛选取代，写法库与公式在设置）。

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/components/settings src/app/settings src/components/retro tests
git commit -m "feat(ui): 设置页收拢(账号定位 / 模型 / Obsidian / 每晚任务 / 写法库 / 预测公式 / 体检) + 锚点导航

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 全站卡片化收尾、真机验收与文档

**Files:**
- Modify: `src/components/settings/*.tsx`、`src/components/topics/*.tsx`、`src/components/assistant/assistant-view.tsx`、`src/components/persona/persona-editor.tsx`、`src/components/project/{script-pane,recording-pane,film-pane,prediction-panel,prediction-summary,note-proposal-card,chat-panel,publish-pane}.tsx`、`src/components/retro/{diagnosis-view,lesson-card,formula-card}.tsx`、`README.md`
- Test: 全量回归

- [ ] **Step 1: 卡片化规则（逐文件套用）**

1. 每个"独立区块"的最外层容器（原 `rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4` / `rounded-md border border-[var(--border-subtle)] p-3` / `rounded-lg border … p-4`）换成 `card`，去掉 `border*`、`bg-*`、`rounded-*`、`p-*` 类。
2. 区块内部的小框（输入、引用、预览、内嵌列表）用 `rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3`，不再加边框。
3. 主按钮（原 `rounded-md bg-[var(--accent)] px-3 py-1… text-[var(--text-on-accent)]`）换成 `btn-primary`；描边按钮（原 `rounded-md border border-[var(--border-strong)] px-3 py-1`）换成 `btn-secondary`。
4. 区块标题统一 `text-[15px] font-semibold`；页面标题统一 `text-[22px] font-bold`；页面外层 `px-4 py-6 md:px-8`（原 `p-8` 在手机上太宽）。
5. `film-pane.tsx`、`recording-pane.tsx` 里写死的颜色（`rg -n "#[0-9a-fA-F]{6}|bg-(black|white|zinc|gray|slate)"` 找出）换成对应变量；`teleprompter.tsx` 不改。

每改完一个文件跑 `npx vitest run <对应测试>`；文本断言不变，类名断言（若有）按新类名更新并记 Ruling。

- [ ] **Step 2: 真机验收（重启 dev）**

1. 电脑宽度依次打开 `/`、`/works`、`/works?stage=published`、`/topics`、`/assistant`、`/settings`、`/projects/<U盘>` 的六步——无报错（`read_console_messages`）。
2. `resize_window` 375×812：每页执行 `document.documentElement.scrollWidth <= document.documentElement.clientWidth` 为真；底部标签栏不遮最后一行（最后一个元素 `getBoundingClientRect().bottom` ≤ 标签栏 `top`，滚到底时）。
3. 对比度抽查：在 `/` 读 `--text-tertiary` 文字与卡片底的计算色，算对比度 ≥ 4.5。
4. `/retro`、`/persona` 跳转正确。
5. 提词器仍为黑底白字。
6. 回到 `desktop` 尺寸。

- [ ] **Step 3: README**

「现在能做什么」开头加一条，并调整受影响的描述：

```markdown
- **界面**：暖白卡片风，5 个入口——总览（今天要处理的事、在做的作品与先发哪条、今日对标；粉丝 / 获赞 / 播放与预测准度；账号走势（每晚记一条快照，满 7 天出曲线）；作品表现对比）、作品（卡片网格，按阶段筛选、按预测排序）、选题、助手、设置（账号定位、模型、Obsidian、每晚任务、写法库、预测公式、体检）。作品工作区顶部是六步步骤条（选题 → 脚本 → 口播 → 成片 → 发布 → 复盘），编导对话收在右下角，有新通知时自动展开。手机上是底部标签栏，编导对话从底部滑出。
```

原「项目」「首页账号数据」「定位」「复盘」相关条目里的入口名同步改为新入口（"侧栏「复盘」" → "「作品 · 已发布」与「设置 · 写法库」"；"定位页" → "「设置 · 账号定位」"）。

- [ ] **Step 4: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add src README.md
git commit -m "style(ui): 全站卡片化收尾(区块卡片、内嵌块、按钮、页面边距; 去掉写死颜色) + README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
