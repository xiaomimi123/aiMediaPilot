import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * 搬进来的零件不假定正确 —— 这是本期的全局约束之一。
 *
 * 已实测的缺陷: NumberRoll 写死 `toLocaleString('en-US')`, 于是把 1850% 渲成
 * `+1,850%`。百分比、年份、编号加千分位都是错的。修法是加一个 `grouping` 开关
 * 并**默认关闭** —— 默认值必须是"不加逗号", 因为出错的那一类(百分比/年份)比
 * 需要千分位的那一类(金额)更常见, 而且加错了比不加更显眼。
 *
 * 这里用源码断言而不是渲染断言: 渲染一帧要起 Chromium, 对一个格式化开关不值当。
 */

const SRC = path.join(process.cwd(), 'remotion/src/motion/components.tsx');

describe('NumberRoll 的千分位', () => {
  const src = fs.readFileSync(SRC, 'utf-8');

  it('有 grouping 开关, 且默认关闭', () => {
    expect(src).toMatch(/grouping\s*\?\s*:\s*boolean/);
    expect(src).toMatch(/grouping\s*=\s*false/);
  });

  it('不再无条件调用 toLocaleString', () => {
    const unconditional = /\{v\.toLocaleString\('en-US'\)\}/.test(src);
    expect(unconditional).toBe(false);
  });

  it('关闭时走 String(v) —— 不是换一种加逗号的写法', () => {
    expect(src).toContain("grouping ? v.toLocaleString('en-US') : String(v)");
  });
});
