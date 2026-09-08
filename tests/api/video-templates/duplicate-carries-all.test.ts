import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * duplicate 的复制清单是手抄的, 三十六期实测漏了 8 个字段(aspect + 整套出镜
 * 版面) —— 复制出镜模板, 副本静默退回默认版面。手抄清单每加一列都可能再漏,
 * 所以这条测试不 mock 请求, 直接做**清单对账**: 从 prisma schema 抽出
 * VideoTemplate 的字段全集, 断言 duplicate 路由源码里每个可复制字段都出现。
 * 源码文本断言比行为断言粗, 但它对"漏抄"这一种错误恰好最灵敏, 且零渲染成本。
 */
const SCHEMA = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const ROUTE = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/v1/video-templates/[id]/duplicate/route.ts'), 'utf-8',
);

// 不该复制的: 身份/归属/时间戳/预设标记(副本刻意置 false)/关系字段
const EXCLUDED = new Set(['id', 'userId', 'name', 'isPreset', 'createdAt', 'updatedAt', 'user']);

describe('duplicate 复制清单对账', () => {
  // 结束定位用行首的 \n} —— 用裸 indexOf('}') 会撞到 @default("{}") 这类字段行内的花括号, 提前截断
  const start = SCHEMA.indexOf('model VideoTemplate');
  const block = SCHEMA.slice(start, SCHEMA.indexOf('\n}', start));
  const fields = [...block.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]).filter((f) => !EXCLUDED.has(f));

  it('schema 字段抽取本身没抽空(抽空时下面的遍历会假绿)', () => {
    expect(fields.length).toBeGreaterThan(15);
    expect(fields).toContain('aspect');
    expect(fields).toContain('pipScale');
  });

  for (const f of fields) {
    it(`复制清单包含 ${f}`, () => {
      expect(ROUTE, `duplicate 路由漏抄了 ${f} —— 副本会静默丢这项配置`).toMatch(new RegExp(`${f}:\\s*(await\\s+)?\\w`));
    });
  }
});
