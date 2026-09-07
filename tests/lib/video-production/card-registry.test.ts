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

  /*
   * data-slot 覆盖率(三十三期补)。
   *
   * 起因: 三十三期五张新卡里, Rank 的标题漏了 data-slot —— 其余四张卡的同位
   * 文字块都打了, 唯独它没有, 而这是靠人工"逐卡片清点"才发现的。下一期要做
   * 「在预览画布上拖动每块文字」, 拖拽层靠 data-slot 找元素:
   * **漏一个标记, 那块文字就永远拖不动, 而且不会报任何错**。
   * 这正是该让机器来数、不该靠人眼清点的那类事。
   *
   * 判据取自组件自己的必填声明: `assertContent(值, 'ring.label')` 这一行就是
   * 组件在说"label 是我的一个文字块", 那它就该有对应的 data-slot。
   * 数组类的(如 rank.rows[0].name)对应模板字面量 slot(`row-${i}-name`),
   * 所以只要求某个 slot 的文本里**包含**这个字段名。
   *
   * **旧四张卡还没有任何 data-slot**(它们早于这个约定)。这里用显式清单放行,
   * 而不是悄悄跳过 —— 下一期做拖拽时要把清单逐个删空, 删一个红一个, 缺口可见。
   */
  const LEGACY_NO_SLOT = ['Statement.tsx', 'Stat.tsx', 'Contrast.tsx', 'ListCard.tsx'];

  it('每个必填文字块都有 data-slot 标记 —— 下一期拖拽靠它找元素', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      if (LEGACY_NO_SLOT.includes(f)) continue;
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');

      // 组件声明的必填文字块: assertContent(x, 'ring.label') -> label
      //                        assertContent(x, `rank.rows[${i}].name`) -> name
      const fields = [...src.matchAll(/assertContent\([^,]+,\s*.([^'"`]+)./g)]
        .map((m) => m[1].split('.').pop() as string)
        .map((x) => x.replace(/\[.*?\]/g, ''));
      expect(fields.length, f + ' 一个 assertContent 都没有, 上面那条正则该改了').toBeGreaterThan(0);

      // 文件里出现过的所有 data-slot 取值(含模板字面量的原文)
      const slots = [...src.matchAll(/data-slot=\{?.([^'"`]+)/g)].map((m) => m[1]);

      for (const field of new Set(fields)) {
        expect(
          slots.some((sl) => sl.includes(field)),
          f + ' 的 ' + field + ' 是必填文字块却没有对应的 data-slot(现有: ' + slots.join(', ') + ')',
        ).toBe(true);
      }
    }
  });

  it('卡片都用了安全区 —— 不是各写各的 padding', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');
      expect(src, `${f} 没有用 safeBox`).toContain('safeBox');
    }
  });
});
