import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { roundToSourceDecimals } from '../../../remotion/src/motion/lib';

/*
 * 人工核对(2026-08-31, 真机跑闲鱼AI服务稿)发现的缺陷: facts 台账里 `32.2%`,
 * 送进 FilmPlan 的 `stat.value` 也正确是 32.2, 但 `NumberRoll`/`Stat` 卡片末帧
 * 定格用 `Math.round(to)`, 把画面渲成整数 `32%` —— 数字仍可在台账里追溯出处
 * (不是编造), 但呈现值和台账不再逐位一致, 是静默的、每个非整数 stat 都会中招的
 * 系统性误差。这个项目的事实护栏要求画面数字必须与出处逐位一致, 所以取整精度
 * 要跟着源值的小数位数走, 不能一律取整数。
 */

describe('roundToSourceDecimals: 取整精度跟随源值小数位', () => {
  it('源值是整数时行为等价于 Math.round', () => {
    expect(roundToSourceDecimals(899.6, 900)).toBe(900);
    expect(roundToSourceDecimals(899.4, 900)).toBe(899);
  });

  it('源值有 1 位小数时, 末帧(value 完全等于 source)保留这 1 位小数, 不取整成整数', () => {
    expect(roundToSourceDecimals(32.2, 32.2)).toBe(32.2);
  });

  it('不凭空补 .0: 源值是整数时结果不带小数位', () => {
    expect(roundToSourceDecimals(900, 900)).toBe(900);
    expect(String(roundToSourceDecimals(900, 900))).toBe('900');
  });

  it('中间帧按同样的小数位数取整, 而不是无限小数', () => {
    // 32.2 的一半, 按 1 位小数取整应为 16.1, 不是 16.099999999999998
    expect(roundToSourceDecimals(16.1, 32.2)).toBe(16.1);
  });
});

describe('渲染层确实用了 roundToSourceDecimals, 不是又写了一份 Math.round', () => {
  const statSrc = fs.readFileSync(
    path.join(process.cwd(), 'remotion/src/cards/Stat.tsx'),
    'utf-8',
  );
  const numberRollSrc = fs.readFileSync(
    path.join(process.cwd(), 'remotion/src/motion/components.tsx'),
    'utf-8',
  );

  it('cards/Stat.tsx 的 shown 走 roundToSourceDecimals', () => {
    expect(statSrc).toMatch(/const shown = roundToSourceDecimals\(p \* slots\.value, slots\.value\)/);
    expect(statSrc).not.toMatch(/const shown = Math\.round\(p \* slots\.value\)/);
  });

  it('motion/components.tsx 的 NumberRoll 的 v 走 roundToSourceDecimals', () => {
    expect(numberRollSrc).toMatch(/const v = roundToSourceDecimals\(easeOut\(prog\(f, at, dur\)\) \* to, to\)/);
    expect(numberRollSrc).not.toMatch(/const v = Math\.round\(easeOut\(prog\(f, at, dur\)\) \* to\)/);
  });
});
