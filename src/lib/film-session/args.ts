import path from 'node:path';

export const FILM_MODELS = ['opus', 'sonnet'] as const;
export const DEFAULT_FILM_MODEL = 'opus';

/** 只放行出片要用的; 白名单外的工具在无界面模式下直接被拒 */
export const FILM_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Write(remotion/films/**)',
  'Edit(remotion/films/**)',
  'Bash(npm run -s mp -- project list)',
  'Bash(npm run -s mp -- project export:*)',
  'Bash(npm run -s mp -- film new:*)',
  'Bash(npm run -s mp -- film check:*)',
  'Bash(npm run -s mp -- film render:*)',
  'Bash(npm run -s mp -- film register:*)',
  'Bash(ffmpeg:*)',
  'Bash(ffprobe:*)',
  'Bash(mkdir -p /tmp/mp-film:*)',
  'Bash(ls:*)',
];

export const FILM_RULES = `你在 MediaPilot 网页里被调用，用户在网页上看你的进度、在停顿时回复你。
- 按 produce-film skill 的流程出片，只做出片相关的事。
- 镜头表 shots.json 写好后停下：用一段话说明切了几镜、怎么用素材，然后问"镜头表可以吗？可以就回复继续"。本轮到此结束。
- 渲染成片（film render，不带 --stills）完成后，不要运行 film register：说明这一版做了什么、用了哪些素材、做了哪些取舍，问"要登记为新版本吗？"。本轮到此结束。
- 用户回复"可以，登记"后再运行 film register（--summary 写这一版做了什么）。
- 拿不准的事（素材丢了、不确定放哪里、要求矛盾）停下来问，不要猜。
- film check 或渲染同一个错误连续 3 次没修好，停下来把报错和你的判断告诉用户。
- 不改 remotion/kit、不删除文件、不碰片子目录以外的文件。`;

export function firstMessage(i: { kind: 'new' | 'revise'; projectId: string; title: string; baseFilmDir?: string; baseVersion?: number; note?: string }): string {
  const note = i.note?.trim();
  if (i.kind === 'new') return `给项目 ${i.projectId}（${i.title}）出一版成片。${note ? `要求：${note}` : ''}`;
  return `改项目 ${i.projectId}（${i.title}）的成片：基于 v${i.baseVersion}（${i.baseFilmDir}）出新的一版。${note ? `修改意见：${note}` : ''}`;
}

export function buildClaudeArgs(i: { message: string; sessionId: string; resume: boolean; model: string }): string[] {
  return [
    '-p',
    i.message,
    ...(i.resume ? ['--resume', i.sessionId] : ['--session-id', i.sessionId]),
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    i.model,
    '--allowedTools',
    FILM_ALLOWED_TOOLS.join(','),
    '--append-system-prompt',
    FILM_RULES,
  ];
}

/** 网页服务的 PATH 里常没有 ~/.local/bin: 依次查 CLAUDE_BIN、常见安装位置、PATH */
export function resolveClaudeBin(env: Record<string, string | undefined>, exists: (p: string) => boolean, home: string): string | null {
  if (env.CLAUDE_BIN && exists(env.CLAUDE_BIN)) return env.CLAUDE_BIN;
  const candidates = [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(env.PATH ?? '').split(':').filter(Boolean).map((d) => path.join(d, 'claude'))];
  return candidates.find((p) => exists(p)) ?? null;
}

/** 网页服务若从某个 Claude Code 会话里启动, 会带上宿主会话的变量; 子进程去掉它们, 按本机 claude 自己的登录运行 */
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || /^CLAUDE_(CODE|AGENT_SDK|PREVIEW)_/.test(k)) continue;
    out[k] = v;
  }
  return out;
}
