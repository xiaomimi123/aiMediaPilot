import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Overlay Studio 集成层(2026-09-20, 方向转型后的口播特效路线)。
 *
 * 背景: 三十七期自建的叠字层被用户实测否决过两轮样式("字幕样式、特效样式都
 * 不行"), 每轮样式迭代 = 改代码+重启 worker+重渲 5 分钟。评估
 * jeszhou/overlay-studio 后拍板: 口播片的特效层改走它 —— 20+ 预制动效卡、
 * 可视化改参 5 秒见效、导出透明 MOV 叠原片一帧不压。
 *
 * **集成边界(授权约束下的刻意设计)**: Studio 是 source-available、禁止商业
 * 再分发的外部工具, 装在 `tools/overlay-studio/`(已 gitignore, 不进本仓库)。
 * 本模块只做三件事 —— 找到它、拉起它的 dev server、调它的 lint CLI ——
 * **绝不 import 它的源码**; MediaPilot 产出的只是它约定格式的 JSON(数据,
 * 不是软件)。它的授权明确允许"接自己的工作流"。
 */

/** Studio 仓库根目录。默认装在项目 tools/ 下(~/Documents 根目录被 macOS TCC 挡, 项目目录是授权过的)。 */
export function studioDir(): string {
  return process.env.OVERLAY_STUDIO_DIR
    || path.join(process.cwd(), 'tools', 'overlay-studio');
}

export function studioAvailable(): boolean {
  return fs.existsSync(path.join(studioDir(), 'motion-playground', 'package.json'));
}

export const STUDIO_URL = 'http://localhost:5177';

/**
 * 确保 Studio dev server 在跑。已在跑(不管是谁起的)就直接复用 —— 用户可能
 * 正在里面编辑, 杀掉重启是破坏性的。没在跑就从 tools/ 目录后台拉起。
 */
export async function ensureStudioRunning(): Promise<{ url: string; started: boolean }> {
  let zombie = false;
  try {
    const res = await fetch(STUDIO_URL, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return { url: STUDIO_URL, started: false };
    // 有响应但不健康(真机撞过: 旧实例的文件被 macOS 权限锁了, 只会回 500)——
    // 端口被它占着, 新实例也起不来, 必须让用户知道要先杀掉它。
    zombie = true;
  } catch {
    // 没在跑, 下面拉起
  }
  if (zombie) {
    throw new Error('5177 端口上有一个响应异常的旧 Overlay Studio 实例 —— 先 pkill -f vite 再重试。');
  }
  if (!studioAvailable()) {
    throw new Error(`Overlay Studio 不在 ${studioDir()} —— 克隆它到该目录, 或设 OVERLAY_STUDIO_DIR`);
  }
  // --strictPort: 端口被占就明确失败, 不许 vite 静默跳 5178(检测的是固定 URL)
  const child = spawn('npm', ['run', 'dev', '--', '--port', '5177', '--strictPort'], {
    cwd: path.join(studioDir(), 'motion-playground'),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // 等它监听端口(vite 冷启约 1~3s), 最多 20s
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(STUDIO_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { url: STUDIO_URL, started: true };
    } catch {
      // 继续等
    }
  }
  throw new Error('Overlay Studio 启动超时(20s) —— 手动在 tools/overlay-studio/motion-playground 里跑 npm run dev 看报错');
}

export interface OverlayLintResult {
  ok: boolean;
  /** error 级(必须修)的原文行 —— 中文、带具体卡号与数值, 直接可喂修复循环。 */
  errors: string[];
  /** warn 级(人判优先)的原文行。 */
  warns: string[];
}

/**
 * 调 Studio 的体检器(它仓库里的 lint:overlay CLI)。
 * 输出契约: 退出码非零 = 有 error; 行首含 ❌/⚠️ 区分级别(实测确认)。
 * 不复刻规则 —— 规则阈值属于 Studio(default + 用户的 local 覆盖), 复刻会两处漂移。
 */
export async function runOverlayLint(jsonPath: string, durationSec: number): Promise<OverlayLintResult> {
  const cwd = path.join(studioDir(), 'motion-playground');
  // 必须绝对化: 子进程 cwd 是 Studio 目录, 相对路径(如 productionRoot 开头的)
  // 会解析到它那边去 —— 真机首跑就这么炸的(文件找不到, lint 崩在读文件)。
  const absJsonPath = path.resolve(jsonPath);
  let stdout = '';
  let failed = false;
  try {
    const r = await execFileAsync('npm', ['run', '-s', 'lint:overlay', '--', absJsonPath, '--duration', String(durationSec)], {
      cwd,
      timeout: 60_000,
    });
    stdout = r.stdout;
  } catch (e) {
    const err = e as { stdout?: string; code?: number };
    stdout = err.stdout ?? '';
    failed = true;
    if (!stdout) {
      const stderr = (e as { stderr?: string }).stderr?.slice(0, 400) ?? '';
      throw new Error(`overlay lint 无输出地失败了(exit ${err.code})${stderr ? `, stderr: ${stderr}` : ''} —— 检查 tools/overlay-studio 是否 npm install 过`);
    }
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => l.startsWith('❌') || l.includes('❌'));
  const warns = lines.filter((l) => l.startsWith('⚠️') || l.includes('⚠️'));
  // 退出码说有错但一行 ❌ 都没解析到 —— 输出格式变了, 宁可把全文当错误也不放行
  if (failed && errors.length === 0) return { ok: false, errors: lines, warns: [] };
  return { ok: !failed, errors, warns };
}
