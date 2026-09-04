import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureShotStill, stillCacheFileName } from '@/lib/video-production/shot-still-cache';

/*
 * 三十一期 Task 3: 剪辑台 renderStill 卡面图接口的渲染+缓存层。
 *
 * 真渲染理由同 `remotion-source-video.test.ts`/`still-check.test.ts`: "缓存文件
 * 是不是真的渲出了卡面、二次请求是不是真的没有重渲"这类问题只有真的跑一遍
 * `renderShotStill` 才作数。
 */

const dirs: string[] = [];
function freshStillsDir(): string {
  const dir = path.join(os.tmpdir(), `shot-still-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function statementShot(text: string, startMs = 0, endMs = 3000) {
  return { shotId: 's1', startMs, endMs, card: 'statement' as const, slots: { text } };
}

describe('ensureShotStill: 真渲染 + 缓存命中 + 孤儿清理', () => {
  it(
    '首次 miss 渲染落盘; 二次同内容请求命中缓存(mtime 不变, 不重渲)',
    async () => {
      const stillsDir = freshStillsDir();
      const opts = {
        stillsDir,
        shotIndex: 0,
        shot: statementShot('第一版文案'),
        aspect: '9:16' as const,
        visualStyle: 'card' as const,
      };

      const first = await ensureShotStill(opts);
      expect(first.hit).toBe(false);
      expect(fs.existsSync(first.filePath)).toBe(true);
      expect(fs.statSync(first.filePath).size).toBeGreaterThan(0);

      const mtimeBefore = fs.statSync(first.filePath).mtimeMs;

      const second = await ensureShotStill(opts);
      expect(second.hit).toBe(true);
      expect(second.filePath).toBe(first.filePath);
      // mtime 不变 —— 命中缓存意味着完全没有再调用 renderShotStill 写这个文件。
      expect(fs.statSync(second.filePath).mtimeMs).toBe(mtimeBefore);

      // 缓存目录里只有这一个文件 —— 命中路径不会意外产生多余文件。
      expect(fs.readdirSync(stillsDir)).toEqual([path.basename(first.filePath)]);
    },
    60_000,
  );

  it(
    '改 plan(该镜文案变了)后 hash 变化 → 新文件生成、旧文件被孤儿清理删除',
    async () => {
      const stillsDir = freshStillsDir();
      const before = { stillsDir, shotIndex: 0, shot: statementShot('改前的文案'), aspect: '9:16' as const, visualStyle: 'card' as const };
      const after = { stillsDir, shotIndex: 0, shot: statementShot('改后的文案'), aspect: '9:16' as const, visualStyle: 'card' as const };

      const r1 = await ensureShotStill(before);
      expect(fs.existsSync(r1.filePath)).toBe(true);
      // 两次内容不同, hash 必须不同(否则下面的"旧文件被清"就测不出东西)。
      const expectedBeforeName = stillCacheFileName(0, before.shot, '9:16', 'card');
      const expectedAfterName = stillCacheFileName(0, after.shot, '9:16', 'card');
      expect(expectedAfterName).not.toBe(expectedBeforeName);

      const r2 = await ensureShotStill(after);
      expect(r2.hit).toBe(false);
      expect(r2.filePath).not.toBe(r1.filePath);
      expect(fs.existsSync(r2.filePath)).toBe(true);
      // 孤儿清理: 旧 hash 的文件应该已经被删掉, 目录里只剩新文件。
      expect(fs.existsSync(r1.filePath)).toBe(false);
      expect(fs.readdirSync(stillsDir)).toEqual([path.basename(r2.filePath)]);
    },
    60_000,
  );
});
