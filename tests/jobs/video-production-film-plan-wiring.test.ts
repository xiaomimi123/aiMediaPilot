import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts'),
  'utf-8',
);
const BRANCH = SRC.slice(
  SRC.indexOf('async function handlePptNarrationRemotion'),
  SRC.indexOf('export async function reportFreeze'),
);

describe('handlePptNarrationRemotion 接上 FilmPlan 生成', () => {
  it('preview 走 buildFilmPlan, 不再直接读手填的 vp.filmPlan', () => {
    expect(BRANCH).toContain('buildFilmPlan');
  });

  it('buildFactsSection 必须显式传 cards —— 默认的 freeform 会让 list 凑数', () => {
    expect(BRANCH).toMatch(/buildFactsSection\([^)]*'cards'\)/s);
  });

  it('产出的 plan 落库到 filmPlan 字段, 供 master 复用', () => {
    expect(BRANCH).toContain('videoProduction.update');
    // 锚住 data 对象里 filmPlan 字段的赋值, 字段名写错(如 plan: plan)或传错变量都会真正变红。
    // 二十九期(Task 3)起 data 里还多落了 alignedActs(供 master 复原字幕/判断有无人声),
    // 所以这里不再锚死 data 对象只有 filmPlan 一个字段。
    expect(BRANCH).toMatch(/data:\s*\{\s*filmPlan:\s*plan\s*,/);
  });

  it('master 不重新调 LLM —— 与旧链 direction.json 的先例一致', () => {
    expect(BRANCH).toMatch(/mode === 'preview'/);
  });

  it('master 复用的 plan 为空时抛错, 不静默回退到重新生成', () => {
    expect(BRANCH).toMatch(/if \(!vp\.filmPlan\) throw/);
  });

  it('取不到六幕稿时抛错, 不静默跳过编排', () => {
    expect(BRANCH).toMatch(/if \(acts\.length === 0\) throw/);
  });

  it('静止体检仍然接着 —— 这个项目栽过两次"新出片路径绕过体检"', () => {
    expect(BRANCH).toContain('reportFreeze');
  });
});

// 三十期 Task 3 反向断言: 旧渲染层已成建制删除(先建后拆的"拆"阶段),
// 原来"一个都没删"的先建后拆断言反过来锁"一个都不剩"。
describe('旧渲染层已成建制删除', () => {
  for (const f of [
    'src/lib/video-production/shot-renderer.ts',
    'src/lib/video-production/ambient-rig.ts',
    'src/lib/video-production/shot-chrome.ts',
    'src/lib/video-production/frame-overlap.ts',
  ]) {
    it(`${f} 已被删除`, () => {
      expect(fs.existsSync(path.join(process.cwd(), f))).toBe(false);
    });
  }
});
