import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'path';

const execFileMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: any) => execFileMock(cmd, args, opts, cb),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { probeDouyinCookie, runDouyinAdapter } from '@/lib/douyin/adapter';

beforeEach(() => {
  execFileMock.mockReset();
  process.env.CHEAT_ADAPTER_PATH = '/adapter';
  process.env.CHEAT_CONTENT_PROJECT_DIR = '/content';
  process.env.PYTHON_BIN = 'python3';
});

describe('probeDouyinCookie', () => {
  it('退出码 0 返回 true', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: '', stderr: '' }));
    expect(await probeDouyinCookie()).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'python3',
      [path.join('/adapter', 'review.py'), 'list'],
      expect.objectContaining({ cwd: '/content', timeout: 30000 }),
      expect.any(Function)
    );
  });

  it('退出码非 0 返回 false', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(new Error('exit 1'), null));
    expect(await probeDouyinCookie()).toBe(false);
  });
});

describe('runDouyinAdapter', () => {
  it('happy path: 从 stdout `✓ <path>` 行解析 report.md 路径', async () => {
    const fakeReportPath = '/Users/test/my-content/videos/2026-03-10_demo/report.md';
    execFileMock.mockImplementation((_c, _a, _o, cb) =>
      cb(null, { stdout: `[抓取] 视频 7234567890\n  → ok\n\n✓ ${fakeReportPath}\n`, stderr: '' })
    );
    const reportPath = await runDouyinAdapter('7234567890');
    expect(reportPath).toBe(fakeReportPath);
    expect(execFileMock).toHaveBeenCalledWith(
      'python3',
      [path.join('/adapter', 'review.py'), 'video', '7234567890'],
      expect.objectContaining({ cwd: '/content', timeout: 300000 }),
      expect.any(Function)
    );
  });

  it('stdout 缺 `✓ <path>` 行抛错', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) =>
      cb(null, { stdout: '[抓取] 视频 7234567890\n抓完没打印路径', stderr: '' })
    );
    await expect(runDouyinAdapter('7234567890')).rejects.toThrow(/未输出 report\.md 路径标记/);
  });

  it('未配置 env 抛错', async () => {
    delete process.env.CHEAT_ADAPTER_PATH;
    await expect(runDouyinAdapter('7234567890')).rejects.toThrow(/未配置/);
  });

  it('adapter 错误 stderr 末 200 字符入 error message', async () => {
    const longErr = 'x'.repeat(500);
    execFileMock.mockImplementation((_c, _a, _o, cb) => {
      const err: any = new Error('exit 1');
      err.stderr = longErr;
      cb(err, null);
    });
    await expect(runDouyinAdapter('7234567890')).rejects.toThrow(/x{200}/);
  });
});
