import { describe, expect, it } from 'vitest';
import { runHealthChecks, type Exec } from '@/lib/health/checks';
import type { CollectStatus } from '@/lib/douyin/collect-log';

const okCollect: CollectStatus = { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' };
const allOk: Exec = async () => ({ code: 0, stdout: 'ok', stderr: '' });

function deps(over: Partial<Parameters<typeof runHealthChecks>[0]> = {}) {
  return {
    exec: allOk,
    exists: async () => true,
    dbPing: async () => {},
    env: { PYTHON_BIN: '/py' } as unknown as NodeJS.ProcessEnv,
    model: { label: 'DeepSeek（deepseek-chat）', grade: 'able_agent' as const },
    cwd: '/repo',
    collect: okCollect,
    scan: okCollect,
    topics: okCollect,
    claudeBin: '/x/claude' as string | null,
    ...over,
  };
}

describe('runHealthChecks', () => {
  it('reports every item ok on a healthy machine', async () => {
    const items = await runHealthChecks(deps());
    expect(items.map((i) => [i.key, i.status])).toEqual([
      ['db', 'ok'], ['model', 'ok'], ['ffmpeg', 'ok'], ['whisper', 'ok'], ['remotion', 'ok'], ['claude', 'ok'], ['collect', 'ok'], ['scan', 'ok'], ['topics', 'ok'],
    ]);
  });
  it('gives an actionable fix for each failure', async () => {
    const items = await runHealthChecks(
      deps({
        dbPing: async () => { throw new Error('ECONNREFUSED'); },
        env: {} as unknown as NodeJS.ProcessEnv,
        model: null,
        exec: async (cmd, args) => (cmd === 'ffmpeg' ? { code: 127, stdout: '', stderr: 'not found' } : args.includes('import faster_whisper') ? { code: 1, stdout: '', stderr: "No module named 'faster_whisper'" } : { code: 0, stdout: '', stderr: '' }),
        exists: async (p) => !p.includes('@remotion'),
        collect: { ...okCollect, state: 'failing', hint: '连续 2 次回采失败：ego lite 没在运行' },
        scan: { ...okCollect, state: 'never', hint: '还没有对标巡检日志。' },
      }),
    );
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by.db.detail).toBe('连不上数据库');
    expect(by.db).toMatchObject({ status: 'fail', fix: '启动 Docker Desktop，然后运行 docker compose up -d' });
    expect(by.model).toMatchObject({ status: 'fail', fix: '在下方「模型」里添加一个' });
    expect(by.ffmpeg).toMatchObject({ status: 'fail', fix: 'brew install ffmpeg' });
    expect(by.whisper.fix).toContain('pip install faster-whisper');
    expect(by.remotion).toMatchObject({ status: 'fail', fix: 'cd remotion && npm install' });
    expect(by.scan).toMatchObject({ status: 'warn', detail: '还没有对标巡检日志。' });
    expect(by.collect).toMatchObject({ status: 'warn', detail: '连续 2 次回采失败：ego lite 没在运行' });
  });
  it('times out a hanging command', async () => {
    const hanging: Exec = async (cmd) => (cmd === 'ffmpeg' ? { code: 124, stdout: '', stderr: 'timeout' } : { code: 0, stdout: '', stderr: '' });
    const items = await runHealthChecks(deps({ exec: hanging }));
    expect(items.find((i) => i.key === 'ffmpeg')).toMatchObject({ status: 'fail', detail: 'ffmpeg 没有响应（超时）' });
  });
  it('checks the local claude command for in-app film', async () => {
    const exec: Exec = async (cmd, args) => (cmd === '/x/claude' && args[0] === '--version' ? { code: 0, stdout: '2.1.285 (Claude Code)\n', stderr: '' } : { code: 0, stdout: 'ok', stderr: '' });
    expect((await runHealthChecks(deps({ exec }))).find((i) => i.key === 'claude')).toEqual({ key: 'claude', label: 'Claude Code（出片）', status: 'ok', detail: 'Claude Code 2.1.285' });
    const missing = (await runHealthChecks(deps({ claudeBin: null }))).find((i) => i.key === 'claude');
    expect(missing).toMatchObject({ status: 'warn' });
    expect(missing?.fix).toContain('安装 Claude Code 后在终端运行 claude 登录');
  });
  it('reports the nightly daily-topics run', async () => {
    const items = await runHealthChecks(deps({ topics: { ...okCollect, state: 'failing', hint: '连续 1 次每日选题失败：还没有可用的模型' } }));
    expect(items.find((i) => i.key === 'topics')).toMatchObject({ label: '每日选题', status: 'warn', detail: '连续 1 次每日选题失败：还没有可用的模型' });
  });
});

