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
