import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderPlist, readSchedule, enableSchedule, disableSchedule, startManualRun, NIGHTLY_TASKS, MANUAL_DAILY_LIMIT, type TaskDeps } from '@/lib/tasks/nightly';

const TEMPLATE = `<plist><dict>
  <key>ProgramArguments</key><array><string>cd "__PROJECT_DIR__" || exit 1; exec npm run collect:douyin</string></array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>20</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
</dict></plist>`;

async function deps(over: Partial<TaskDeps> = {}): Promise<TaskDeps & { calls: string[][] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-tasks-'));
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(dir, 'scripts', `${NIGHTLY_TASKS.collect.launchdLabel}.plist`), TEMPLATE);
  const calls: string[][] = [];
  return {
    calls,
    projectDir: dir,
    agentsDir: path.join(dir, 'LaunchAgents'),
    exec: vi.fn(async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { code: cmd === 'pgrep' ? 1 : 0, stdout: '', stderr: '' };
    }),
    spawnDetached: vi.fn(),
    now: () => new Date('2026-09-29T03:00:00Z'),
    ...over,
  };
}

describe('plist', () => {
  it('renders the project dir and the chosen time', () => {
    const p = renderPlist(TEMPLATE, '/p', 21, 5);
    expect(p).toContain('cd "/p"');
    expect(p).toMatch(/<key>Hour<\/key>\s*<integer>21<\/integer>/);
    expect(p).toMatch(/<key>Minute<\/key>\s*<integer>5<\/integer>/);
  });
  it('reads the schedule back, or reports it off', () => {
    expect(readSchedule(renderPlist(TEMPLATE, '/p', 21, 5), NIGHTLY_TASKS.collect)).toEqual({ enabled: true, hour: 21, minute: 5 });
    expect(readSchedule(null, NIGHTLY_TASKS.scan)).toEqual({ enabled: false, hour: 20, minute: 30 });
  });
});

describe('enable / disable', () => {
  it('writes the plist into LaunchAgents and reloads it', async () => {
    const d = await deps();
    await enableSchedule(d, 'collect', 21, 5);
    const written = await fs.readFile(path.join(d.agentsDir, 'com.mediapilot.collect-douyin.plist'), 'utf8');
    expect(written).toMatch(/<integer>21<\/integer>/);
    expect(d.calls.map((c) => c.slice(0, 3).join(' '))).toEqual(['launchctl unload -w', 'launchctl load -w']);
  });
  it('rejects an impossible time', async () => {
    const d = await deps();
    await expect(enableSchedule(d, 'collect', 25, 0)).rejects.toThrow('时间不对');
  });
  it('unloads and removes the plist when turned off', async () => {
    const d = await deps();
    await enableSchedule(d, 'collect', 20, 0);
    await disableSchedule(d, 'collect');
    await expect(fs.access(path.join(d.agentsDir, 'com.mediapilot.collect-douyin.plist'))).rejects.toThrow();
    expect(d.calls.at(-1)?.slice(0, 3).join(' ')).toBe('launchctl unload -w');
  });
});

describe('startManualRun', () => {
  it('starts the npm script in the background, appending to the task log', async () => {
    const d = await deps();
    expect(await startManualRun(d, 'scan')).toEqual({ ok: true, left: MANUAL_DAILY_LIMIT - 1 });
    expect(d.spawnDetached).toHaveBeenCalledWith('scan:benchmarks', path.join(d.projectDir, 'logs', 'scan-benchmarks.log'));
  });
  it('refuses while the task is already running (nightly or manual)', async () => {
    const d = await deps({ exec: vi.fn(async () => ({ code: 0, stdout: '123', stderr: '' })) });
    expect(await startManualRun(d, 'scan')).toEqual({ ok: false, reason: '对标巡检正在跑，等它跑完再点。' });
    expect(d.spawnDetached).not.toHaveBeenCalled();
  });
  it('allows 3 manual runs a day to protect the account', async () => {
    const d = await deps();
    for (let i = 0; i < MANUAL_DAILY_LIMIT; i++) expect((await startManualRun(d, 'collect')).ok).toBe(true);
    expect(await startManualRun(d, 'collect')).toEqual({ ok: false, reason: '作品数据回采今天已经手动跑了 3 次（保护账号），明天再试，或等每晚定时的那次。' });
  });
});
