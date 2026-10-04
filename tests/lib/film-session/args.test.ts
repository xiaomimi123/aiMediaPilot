import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, childEnv, restartMessage, FILM_ALLOWED_TOOLS, FILM_RULES, firstMessage, resolveClaudeBin } from '@/lib/film-session/args';

describe('film session args', () => {
  it('whitelists only film work', () => {
    expect(FILM_ALLOWED_TOOLS).toContain('Write(remotion/films/**)');
    expect(FILM_ALLOWED_TOOLS).toContain('Bash(npm run -s mp -- film register:*)');
    expect(FILM_ALLOWED_TOOLS.some((t) => /^Bash\((git|rm|curl)/.test(t))).toBe(false);
    expect(FILM_ALLOWED_TOOLS).not.toContain('Bash');
    expect(FILM_ALLOWED_TOOLS).not.toContain('Write');
  });
  it('tells it where to stop', () => {
    expect(FILM_RULES).toContain('镜头表可以吗？可以就回复继续');
    expect(FILM_RULES).toContain('不要运行 film register');
    expect(FILM_RULES).toContain('连续 3 次');
  });
  it('builds the first message for new and revise', () => {
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', note: '节奏快一点' })).toBe('给项目 p1（U盘）出一版成片。要求：节奏快一点');
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘' })).toBe('给项目 p1（U盘）出一版成片。');
    expect(firstMessage({ kind: 'revise', projectId: 'p1', title: 'U盘', baseFilmDir: 'remotion/films/p1-v2', baseVersion: 2, note: '第 3 镜太挤' })).toBe('改项目 p1（U盘）的成片：基于 v2（remotion/films/p1-v2）出新的一版。修改意见：第 3 镜太挤');
  });
  it('starts a session and resumes it later', () => {
    const first = buildClaudeArgs({ message: '出片', sessionId: 'abc', resume: false, model: 'opus' });
    expect(first[0]).toBe('-p');
    expect(first.at(-1)).toBe('出片');
    expect(first).toEqual(expect.arrayContaining(['--session-id', 'abc', '--output-format', 'stream-json', '--verbose', '--model', 'opus', '--append-system-prompt', FILM_RULES]));
    expect(first[first.indexOf('--allowedTools') + 1]).toBe(FILM_ALLOWED_TOOLS.join(','));
    const next = buildClaudeArgs({ message: '可以，继续', sessionId: 'abc', resume: true, model: 'sonnet' });
    expect(next).toEqual(expect.arrayContaining(['--resume', 'abc', '--model', 'sonnet']));
    expect(next).not.toContain('--session-id');
  });
  it('finds claude in common install locations', () => {
    const home = '/Users/me';
    expect(resolveClaudeBin({ CLAUDE_BIN: '/x/claude' }, () => true, home)).toBe('/x/claude');
    expect(resolveClaudeBin({}, (p) => p === '/Users/me/.local/bin/claude', home)).toBe('/Users/me/.local/bin/claude');
    expect(resolveClaudeBin({ PATH: '/a:/b' }, (p) => p === '/b/claude', home)).toBe('/b/claude');
    expect(resolveClaudeBin({}, () => false, home)).toBeNull();
  });
  it('drops the host claude session vars from the child env', () => {
    const env = childEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_ENTRYPOINT: 'y', CLAUDE_AGENT_SDK_VERSION: 'z', CLAUDE_PID: '1', ANTHROPIC_BASE_URL: 'u' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', ANTHROPIC_BASE_URL: 'u' });
  });
  it('puts the message after -- so a reply starting with - is not a flag', () => {
    const a = buildClaudeArgs({ message: '--dangerously-skip-permissions 第3镜太长', sessionId: 'abc', resume: true, model: 'opus' });
    expect(a.slice(-2)).toEqual(['--', '--dangerously-skip-permissions 第3镜太长']);
    expect(a[0]).toBe('-p');
  });
  it('ignores project and local settings and denies risky tools as a backstop', () => {
    const a = buildClaudeArgs({ message: 'x', sessionId: 'abc', resume: false, model: 'opus' });
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('user');
    const denied = a[a.indexOf('--disallowedTools') + 1].split(',');
    for (const t of ['Bash(git:*)', 'Bash(rm:*)', 'Bash(node:*)', 'Bash(npx:*)', 'Bash(killall:*)', 'Bash(npm run dev:*)', 'Write(src/**)', 'Edit(remotion/kit/**)', 'Read(./.env)']) expect(denied).toContain(t);
    expect(FILM_RULES).toContain('.claude/skills/produce-film/SKILL.md');
  });
  it('stops after the shot list even when it is reused from the base version', () => {
    expect(FILM_RULES).toContain('改片时镜头表沿用旧版也要停');
  });
  it('asks for a landscape film with the right commands', () => {
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', note: '多放录屏', orientation: 'landscape' })).toBe(
      '给项目 p1（U盘）出一版横版成片（画面 1920×1080）。用 `npm run -s mp -- film new p1 --landscape` 建片子目录，检查时用 `npm run -s mp -- film check <片子目录> --expect landscape`。要求：多放录屏',
    );
    expect(firstMessage({ kind: 'revise', projectId: 'p1', title: 'U盘', baseFilmDir: 'remotion/films/p1-v4', baseVersion: 4, note: '录屏放大', orientation: 'landscape' })).toBe(
      '改项目 p1（U盘）的成片：基于 v4（remotion/films/p1-v4）出新的一版横版（画面 1920×1080）。用 `npm run -s mp -- film new p1 --landscape` 建片子目录，检查时用 `npm run -s mp -- film check <片子目录> --expect landscape`。修改意见：录屏放大',
    );
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', orientation: 'portrait' })).toBe('给项目 p1（U盘）出一版成片。');
  });
  it('does not rely on mkdir (headless mode always asks before mkdir)', () => {
    expect(FILM_ALLOWED_TOOLS.some((t) => t.includes('mkdir'))).toBe(false);
  });
  it('restarts in a fresh conversation from the check step without rebuilding the film', () => {
    expect(restartMessage({ projectId: 'p1', title: 'U盘', filmDir: 'remotion/films/p1-v4', orientation: 'landscape' })).toBe(
      '继续给项目 p1（U盘）出横版成片。上一段对话太长中断了，这是新对话：片子目录 remotion/films/p1-v4 里的镜头表 shots.json 和画面 Film.tsx、copy.ts 都已经写好。不要 film new，不要重排镜头表。先读 .claude/skills/produce-film/SKILL.md 和这几个文件，从第 6 步开始：检查（`npm run -s mp -- film check remotion/films/p1-v4 --expect landscape`）→ 出关键帧逐张看 → 有问题就改 → 渲染成片，然后停下来等我确认。',
    );
    expect(restartMessage({ projectId: 'p1', title: 'U盘', filmDir: 'remotion/films/p1-v4', orientation: 'portrait' })).toContain('出成片。');
    expect(restartMessage({ projectId: 'p1', title: 'U盘', filmDir: 'remotion/films/p1-v4', orientation: 'portrait' })).toContain('`npm run -s mp -- film check remotion/films/p1-v4`）');
  });
});
