import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';

/** ego lite 的命令行(共享用户已登录的浏览器状态)。回采与对标巡检共用。 */
export const EGO_BIN = path.join(homedir(), '.local/bin/ego-browser');

/** ego lite 没开、登录过期、脚本超时 —— 调用方统一提示"打开 ego lite 重新登录" */
export class EgoUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EgoUnavailableError';
  }
}

/**
 * 把脚本喂给 `ego-browser nodejs` 并收集输出。
 *
 * 两个坑, 都踩过:
 * 1. **必须手动写 stdin**: `execFile` 的异步版本不支持 `input` 选项(那是
 *    execFileSync/spawnSync 的), 传了会被静默忽略, ego 一直等 stdin 直到超时。
 * 2. **`cliLog` 写的是 stderr 不是 stdout**。用 heredoc 手跑时两个流都打在终端上,
 *    完全看不出区别; 一旦分开管道接, 只读 stdout 就永远是空的。所以这里把两个流
 *    合起来找结果标记。
 */
export function runEgo(script: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(EGO_BIN, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`超时 ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // cliLog 走 stderr, 结果标记也在里面 —— 两个流合起来给调用方
      if (code === 0) resolve(`${out}\n${err}`);
      else reject(new Error(`退出码 ${code}\n${err.slice(0, 600)}`));
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

const MARKER = '@@RESULT@@';

/** 脚本用 cliLog('@@RESULT@@' + JSON) 输出结果; 取标记后那一行 */
export function readResult(output: string): unknown {
  const i = output.lastIndexOf(MARKER);
  if (i < 0) throw new Error(`ego-browser 没有输出结果标记: ${output.slice(0, 300)}`);
  return JSON.parse(output.slice(i + MARKER.length).split('\n')[0]);
}
