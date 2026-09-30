import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findJobId, installHermes, type HermesDeps } from '@/lib/cli/hermes';

const LIST = `
  c2cfaca10adf [paused]
    Name:      每周内容分类
    Schedule:  0 20 * * 0

  9a8b7c6d5e4f [active]
    Name:      MediaPilot 每日简报
    Schedule:  30 8 * * *
`;

async function deps(listOut = ''): Promise<HermesDeps & { calls: string[][] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-hermes-'));
  const projectDir = path.join(root, 'proj');
  await fs.mkdir(path.join(projectDir, 'agents', 'hermes', 'mediapilot'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'agents', 'hermes', 'mediapilot', 'SKILL.md'), '# skill');
  const calls: string[][] = [];
  return {
    calls,
    hermesHome: path.join(root, '.hermes'),
    projectDir,
    nodeBinDir: '/opt/homebrew/bin',
    now: () => new Date('2026-09-29T10:00:00Z'),
    exec: vi.fn(async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: args[1] === 'list' ? listOut : '', stderr: '' };
    }),
  };
}

describe('hermes install', () => {
  it('finds a job id by name', () => {
    expect(findJobId(LIST, 'MediaPilot 每日简报')).toBe('9a8b7c6d5e4f');
    expect(findJobId(LIST, '不存在')).toBeNull();
  });
  it('copies the skill, writes the brief script and creates a no-agent cron job', async () => {
    const d = await deps();
    const r = await installHermes(d, { hour: 8, minute: 30, deliver: 'all' });
    expect(await fs.readFile(path.join(d.hermesHome, 'skills', 'mediapilot', 'SKILL.md'), 'utf8')).toBe('# skill');
    const script = await fs.readFile(path.join(d.hermesHome, 'scripts', 'mediapilot-brief.sh'), 'utf8');
    expect(script).toContain(`cd "${d.projectDir}"`);
    expect(script).toContain('MP_AGENT=hermes npm run -s mp -- brief');
    expect(script).toContain('export PATH="/opt/homebrew/bin:$PATH"');
    expect(d.calls.find((c) => c[2] === 'create')).toEqual(['hermes', 'cron', 'create', '30 8 * * *', '--name', 'MediaPilot 每日简报', '--script', 'mediapilot-brief.sh', '--no-agent', '--deliver', 'all']);
    expect(r).toMatchObject({ backup: null, jobReplaced: false });
  });
  it('stops before touching anything when hermes is missing', async () => {
    const d = await deps();
    d.exec = vi.fn(async () => ({ code: 127, stdout: '', stderr: 'spawn hermes ENOENT' }));
    await expect(installHermes(d, { hour: 8, minute: 30, deliver: 'all' })).rejects.toThrow('找不到 hermes 命令');
    await expect(fs.stat(path.join(d.hermesHome, 'skills', 'mediapilot'))).rejects.toThrow();
  });
  it('lists disabled jobs too, and creates the new job before removing the old one', async () => {
    const d = await deps(LIST);
    await installHermes(d, { hour: 8, minute: 30, deliver: 'all' });
    const verbs = d.calls.map((c) => c.slice(1, 3).join(' '));
    expect(d.calls).toContainEqual(['hermes', 'cron', 'list', '--all']);
    expect(verbs.indexOf('cron create')).toBeLessThan(verbs.indexOf('cron remove'));
  });
  it('backs up an existing skill dir and replaces an existing job', async () => {
    const d = await deps(LIST);
    await fs.mkdir(path.join(d.hermesHome, 'skills', 'mediapilot'), { recursive: true });
    await fs.writeFile(path.join(d.hermesHome, 'skills', 'mediapilot', 'SKILL.md'), 'old');
    const r = await installHermes(d, { hour: 9, minute: 0, deliver: 'all' });
    expect(r.backup).toMatch(/mediapilot\.bak-/);
    expect(await fs.readFile(path.join(r.backup!, 'SKILL.md'), 'utf8')).toBe('old');
    expect(d.calls).toContainEqual(['hermes', 'cron', 'remove', '9a8b7c6d5e4f']);
    expect(d.calls.find((c) => c[2] === 'create')?.[3]).toBe('0 9 * * *');
    expect(r.jobReplaced).toBe(true);
  });
});
