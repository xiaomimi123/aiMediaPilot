import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/*
 * `reportFreeze` 是出片最后一道关, **只写日志**, 不落库也不改状态 —— 除了真跑一遍
 * 拿它的输出之外没有别的观测点。所以这里用 ffmpeg 现造两条样本片真跑:
 * 一条纯静止、一条一直在动, 断言两个分支各自打出该打的话。
 *
 * 为什么值得单独测: 这个模块写完之后一度**全项目没有任何调用方**, 只在一次性脚本里
 * 跑过。接线本身才是这次要锁住的东西 —— 同样的坑在这个项目里栽过一次(并排检测)。
 */

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const exec = promisify(execFile);
let dir = '';
let frozenPath = '';
let movingPath = '';

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freeze-report-'));
  frozenPath = path.join(dir, 'frozen.mp4');
  movingPath = path.join(dir, 'moving.mp4');
  // 纯色 3 秒 = 全片静止。**静止一直持续到片尾时 ffmpeg 只打 freeze_start、不打
  // freeze_duration**, 所以这条样本同时守着那个曾经把最坏一段整个漏掉的解析 bug。
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=3:r=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', frozenPath]);
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=3:r=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', movingPath]);
}, 120_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('reportFreeze —— 出片最后一道静止关', () => {
  it('整片死画面 → 报出不通过, 并说清占了多少', async () => {
    const { reportFreeze } = await import('@/jobs/workers/video-production-worker');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const report = await reportFreeze(frozenPath, 'preview');
    const said = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    warn.mockRestore();
    expect(said).toContain('静止体检不通过');
    expect(said).toMatch(/纹丝不动/);
    // 报告要能落库给界面读: 判定、占比、最坏几段都在里面
    expect(report?.ok).toBe(false);
    expect(report?.ratio).toBeGreaterThan(0.5);
    expect(report?.worst.length).toBeGreaterThan(0);
    expect(report?.kind).toBe('preview');
  }, 60_000);

  it('一直在动 → 通过, 并把实测数字打出来(不能只在失败时才有输出)', async () => {
    const { reportFreeze } = await import('@/jobs/workers/video-production-worker');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const report = await reportFreeze(movingPath, 'master');
    const said = log.mock.calls.map((c) => c.join(' ')).join('\n');
    const warned = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore(); warn.mockRestore();
    expect(said).toContain('静止体检通过');
    expect(warned).not.toContain('静止体检');
    expect(report?.ok).toBe(true);
    expect(report?.kind).toBe('master');
  }, 60_000);

  it('文件不存在 → 只警告, 不抛 —— 体检是观测, 不该拖垮出片', async () => {
    const { reportFreeze } = await import('@/jobs/workers/video-production-worker');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(reportFreeze(path.join(dir, '不存在.mp4'), 'preview')).resolves.toBeNull();
    warn.mockRestore();
  }, 60_000);
});
