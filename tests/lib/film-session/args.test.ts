import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, childEnv, FILM_ALLOWED_TOOLS, FILM_RULES, firstMessage, resolveClaudeBin } from '@/lib/film-session/args';

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
});
