import fs from 'node:fs';
import path from 'node:path';

/** 产品录屏3D 的路径和命令参数。渲染本身在 render.ts，这里不碰 Remotion。 */

export const SCREENREC_STEPS = ['record', 'voice', 'build', 'render', 'verify', 'cleanup'] as const;
export type ScreenrecStep = (typeof SCREENREC_STEPS)[number];

export interface ScreenrecConfig {
  name: string;
  formatTag: string;
  workDir: string;
  verify?: { keyTimes?: number[] };
  record: unknown;
  shots: unknown[];
  voice: unknown;
}

export function isScreenrecConfig(v: unknown): v is ScreenrecConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.formatTag === '产品录屏3D' && typeof o.name === 'string' && typeof o.workDir === 'string' && !!o.record && Array.isArray(o.shots) && !!o.voice;
}

export function screenrecLayout(repoRoot: string) {
  const root = path.join(repoRoot, 'remotion', 'screenrec');
  return {
    root,
    entry: path.join(root, 'src', 'index.tsx'),
    outDir: path.join(root, 'out'),
    scripts: {
      record: path.join(root, 'scripts', 'record.js'),
      voice: path.join(root, 'scripts', 'voice.py'),
      build: path.join(root, 'scripts', 'build.py'),
      verify: path.join(root, 'scripts', 'verify.py'),
      cleanup: path.join(root, 'scripts', 'cleanup.py'),
    },
    renderTs: path.join(repoRoot, 'remotion', 'scripts', 'render.ts'),
    tsx: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
  };
}

export function readScreenrecProject(configPath: string, repoRoot: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  } catch {
    throw new Error(`读不了配置：${configPath}`);
  }
  if (!isScreenrecConfig(raw)) throw new Error(`不是产品录屏3D 配置（formatTag 须为「产品录屏3D」）：${configPath}`);
  const layout = screenrecLayout(repoRoot);
  const work = path.resolve(layout.root, raw.workDir);
  return {
    cfg: raw,
    work,
    props: path.join(work, 'build', 'props.json'),
    publicDir: path.join(work, 'build', 'public'),
    keyframes: path.join(work, 'keyframes'),
    layout,
  };
}

function readConfigIfScreenrec(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    return isScreenrecConfig(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
  } catch {
    return false;
  }
}

/** 片子目录里已有 shots.json 的，仍走原来的章节档案/极客手账，不误判成这条。 */
export function screenrecConfigPath(target: string): string | null {
  const abs = path.resolve(target);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (st.isFile()) return readConfigIfScreenrec(abs) ? abs : null;
  if (!st.isDirectory()) return null;
  if (fs.existsSync(path.join(abs, 'shots.json'))) return null;
  const direct = path.join(abs, 'project.config.json');
  if (readConfigIfScreenrec(direct)) return direct;
  const parent = path.resolve(abs, '..', 'project.config.json');
  if (readConfigIfScreenrec(parent)) return parent;
  return null;
}

export function nextTrialFile(dir: string, name: string, formatTag: string, exists: (p: string) => boolean): string {
  const base = `${name.toLowerCase()}_${formatTag}`;
  let n = 1;
  let file = path.join(dir, `${base}_trial${n}_1920x1080.mp4`);
  while (exists(file)) {
    n += 1;
    file = path.join(dir, `${base}_trial${n}_1920x1080.mp4`);
  }
  return file;
}

/** mp film render 命中产品录屏3D 配置时，转给同一条 render.ts。 */
export function filmRenderScreenrecArgs(configPath: string, flags: { stills?: boolean; shots?: string | true }): string[] {
  if (flags.shots) throw new Error('产品录屏3D 的关键帧用配置里的 verify.keyTimes，不要加 --shots');
  if (flags.stills) return ['--screenrec', configPath, '--keys'];
  return ['--screenrec', configPath, '--film'];
}

const STEP_FLAGS: Record<ScreenrecStep, { bool: string[]; value: string[] }> = {
  record: { bool: ['prep-only', 'shots-only', 'no-shots'], value: ['only'] },
  voice: { bool: ['check'], value: ['env-file', 'import-props', 'import-mp3'] },
  build: { bool: [], value: [] },
  render: { bool: [], value: ['keys', 'film'] },
  verify: { bool: ['no-asr'], value: [] },
  cleanup: { bool: [], value: [] },
};

function isStep(step: string): step is ScreenrecStep {
  return (SCREENREC_STEPS as readonly string[]).includes(step);
}

export interface ScreenrecInvoke {
  cmd: string;
  args: string[];
}

export function screenrecInvocation(opts: {
  repoRoot: string;
  configPath: string;
  step: string;
  positionals: string[];
  flags: Record<string, string | true>;
  python: string;
  node: string;
}): ScreenrecInvoke {
  if (!isStep(opts.step)) throw new Error(`没有这一步：${opts.step}。可用 ${SCREENREC_STEPS.join('、')}`);
  const step = opts.step;
  if (!fs.existsSync(opts.configPath)) throw new Error(`找不到配置：${opts.configPath}`);
  readScreenrecProject(opts.configPath, opts.repoRoot);
  const spec = STEP_FLAGS[step];
  const known = new Set([...spec.bool, ...spec.value, 'json']);
  const unknown = Object.keys(opts.flags).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`这一步不能用：${unknown.map((k) => `--${k}`).join('、')}`);
  if (step !== 'verify' && opts.positionals.length) throw new Error('这一步没有更多位置参数');
  const layout = screenrecLayout(opts.repoRoot);
  const flagArgs: string[] = [];
  for (const name of spec.bool) {
    if (opts.flags[name] === true) flagArgs.push(`--${name}`);
    else if (opts.flags[name] !== undefined) throw new Error(`--${name} 不带值`);
  }
  const value = (name: string): string | true | undefined => {
    const v = opts.flags[name];
    return v === undefined ? undefined : v;
  };
  if (step === 'record') {
    const only = value('only');
    if (only === true) throw new Error('--only 要写片段名，例如 --only fill,template');
    if (typeof only === 'string') flagArgs.push(`--only=${only}`);
    return { cmd: opts.node, args: [layout.scripts.record, opts.configPath, ...flagArgs] };
  }
  if (step === 'voice') {
    const envFile = value('env-file');
    const props = value('import-props');
    const mp3 = value('import-mp3');
    if (envFile === true || props === true || mp3 === true) throw new Error('--env-file、--import-props、--import-mp3 都要带路径');
    if ((props === undefined) !== (mp3 === undefined)) throw new Error('--import-props 和 --import-mp3 要一起给');
    if (typeof envFile === 'string') flagArgs.push('--env-file', path.resolve(envFile));
    if (typeof props === 'string' && typeof mp3 === 'string') flagArgs.push('--import-props', path.resolve(props), '--import-mp3', path.resolve(mp3));
    return { cmd: opts.python, args: [layout.scripts.voice, opts.configPath, ...flagArgs] };
  }
  if (step === 'build') return { cmd: opts.python, args: [layout.scripts.build, opts.configPath] };
  if (step === 'cleanup') return { cmd: opts.python, args: [layout.scripts.cleanup, opts.configPath] };
  if (step === 'verify') {
    const film = opts.positionals[0];
    if (opts.positionals.length !== 1 || !film) throw new Error('verify 要带成片路径：mp film screenrec <配置> verify <成片.mp4>');
    return { cmd: opts.python, args: [layout.scripts.verify, opts.configPath, path.resolve(film), ...flagArgs] };
  }
  const keys = value('keys');
  const film = value('film');
  if ((keys === undefined) === (film === undefined)) throw new Error('render 用 --keys 或 --film，不要两个一起，也不要都不写');
  if (keys !== undefined) {
    flagArgs.push('--keys');
    if (typeof keys === 'string') flagArgs.push(keys);
  } else {
    flagArgs.push('--film');
    if (typeof film === 'string') flagArgs.push(path.resolve(film));
  }
  return { cmd: layout.tsx, args: [layout.renderTs, '--screenrec', opts.configPath, ...flagArgs] };
}
