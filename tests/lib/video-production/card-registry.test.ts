import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_TYPES } from '@/lib/video-production/shot-plan';

/*
 * 注册表与契约必须对齐: schema 里有的卡片, 渲染层必须有实现, 否则模型选了一种
 * 我们画不出来的卡, 出片时才炸 —— 这个项目里"契约与实现漂移"栽过不止一次
 * (并排检测写完不接线、ContentAsset 有表无门)。
 *
 * 另外锁住"卡片里不许出现绝对坐标"这条 —— 验货时人手填坐标都撞出了重叠。
 */

const CARDS_DIR = path.join(process.cwd(), 'remotion/src/cards');

describe('卡片注册表', () => {
  const index = fs.readFileSync(path.join(CARDS_DIR, 'index.ts'), 'utf-8');

  it('schema 里的每种卡片都有实现', () => {
    for (const t of CARD_TYPES) {
      expect(index).toMatch(new RegExp(`\\b${t}\\s*:`));
    }
  });

  it('每张卡都有自己的文件', () => {
    const files = fs.readdirSync(CARDS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(CARD_TYPES.length + 1); // +1 = index.ts
  });

  it('卡片里不许出现绝对定位 —— 版面必须走栅格', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');
      expect(src, `${f} 用了 position:absolute`).not.toMatch(/position:\s*['"]absolute/);
    }
  });

  it('卡片都用了安全区 —— 不是各写各的 padding', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');
      expect(src, `${f} 没有用 safeBox`).toContain('safeBox');
    }
  });
});
