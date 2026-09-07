import type { Config } from 'tailwindcss';

/*
 * 三十四期 UI 重做: 两层颜色并存, 各有用途 ——
 *
 * ① shadcn 语义层(background/card/primary/...): hsl(var()) 形式, 支持 /alpha 修饰,
 *    47 个既有组件全走这层。桥接值在 globals.css。
 * ② 设计令牌直通层(canvas/base/surface/ok/warn/...): 直接引用 tokens.css 的变量,
 *    给按设计稿新写的界面用, 类名与设计交付 README 的映射表一致。
 *    注意这层是 hex var, **不支持 /alpha 修饰**(写了不报错但静默失效) ——
 *    需要半透明时用 ①, 或用 tokens 里现成的 *-subtle。
 *
 * 撞名说明: 设计稿的 "accent"(靛蓝)映射到 ① 的 `primary`;
 * ① 的 `accent` 保持 shadcn 语义(hover/选中底)。设计交付 README §3 建议的
 * `accent.{DEFAULT,hover}` 命名没有采用, 因为既有组件的 bg-accent/50 会全部变成
 * 靛蓝洗底 —— 新写代码里的靛蓝一律用 primary / brand-*。
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        // ── ① shadcn 语义层(支持 /alpha) ──
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          // 变量名是 --ui-hover 而不是 --accent: 后者被 tokens.css 占用(靛蓝 hex),
          // 同名会互相覆盖 —— 见 globals.css 桥接层的注释。
          DEFAULT: 'hsl(var(--ui-hover))',
          foreground: 'hsl(var(--ui-hover-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 状态色的 /alpha 版(hex 真源在 tokens.css)
        ok: { DEFAULT: 'hsl(var(--status-success))', subtle: 'var(--success-subtle)' },
        warn: { DEFAULT: 'hsl(var(--status-warning))', subtle: 'var(--warning-subtle)' },
        bad: { DEFAULT: 'hsl(var(--status-danger))', subtle: 'var(--danger-subtle)' },
        info: { DEFAULT: 'hsl(var(--status-info))', subtle: 'var(--info-subtle)' },
        soft: { DEFAULT: 'hsl(var(--status-soft))', subtle: 'var(--soft-subtle)' },

        // ── ② 设计令牌直通层(不支持 /alpha) ──
        canvas: 'var(--bg-canvas)',
        base: 'var(--bg-base)',
        surface: { DEFAULT: 'var(--bg-surface)', hover: 'var(--bg-surface-hover)' },
        elevated: 'var(--bg-elevated)',
        inset: 'var(--bg-inset)',
        line: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        fg: {
          DEFAULT: 'var(--text-primary)',
          2: 'var(--text-secondary)',
          3: 'var(--text-tertiary)',
          4: 'var(--text-disabled)',
        },
        brand: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
          line: 'var(--accent-border)',
        },
      },
      fontFamily: {
        sans: ['var(--font)'],
        mono: ['var(--mono)'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      spacing: {
        sidebar: 'var(--sidebar-w)',
        rail: 'var(--rail-w)',
        panel: 'var(--panel-w)',
        topbar: 'var(--topbar-h)',
      },
    },
  },
  plugins: [],
};

export default config;
