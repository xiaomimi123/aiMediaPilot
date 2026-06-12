import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

interface AdapterEnv {
  adapterPath: string;
  contentDir: string;
  pythonBin: string;
}

function readAdapterEnv(): AdapterEnv {
  const adapterPath = process.env.CHEAT_ADAPTER_PATH;
  const contentDir = process.env.CHEAT_CONTENT_PROJECT_DIR;
  if (!adapterPath || !contentDir) {
    throw new Error('CHEAT_ADAPTER_PATH 或 CHEAT_CONTENT_PROJECT_DIR 未配置');
  }
  return {
    adapterPath,
    contentDir,
    pythonBin: process.env.PYTHON_BIN || 'python3',
  };
}

/**
 * 跑 review.py list 检测 cookie。退出码 0 = 有效。
 *
 * 注: cheat-on-content 的 crawler.py 没有 CLI 子命令 (它的 main 只调 ensure_login),
 *     review.py 才有 list/video/login 三个子命令。review.py list 直接走 fetch_recent_videos,
 *     cookie 失效时会在打开创作者中心首页时拿不到数据 → 我们的 30s 超时会杀掉它,
 *     退出码非 0,probeDouyinCookie 返回 false。
 */
export async function probeDouyinCookie(): Promise<boolean> {
  let env: AdapterEnv;
  try {
    env = readAdapterEnv();
  } catch {
    return false;
  }

  try {
    await execFileAsync(
      env.pythonBin,
      [path.join(env.adapterPath, 'review.py'), 'list'],
      { cwd: env.contentDir, timeout: 30_000 }
    );
    return true;
  } catch {
    return false;
  }
}

/** 跑 review.py video <aweme_id> 拉取数据。 返回 report.md 绝对路径。 */
export async function runDouyinAdapter(awemeId: string): Promise<string> {
  const { adapterPath, contentDir, pythonBin } = readAdapterEnv();

  const outputDir = path.join(os.tmpdir(), `retro-${awemeId}-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  await fs.writeFile(scriptPath, `# placeholder\nawemeId: ${awemeId}\n`);

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      [path.join(adapterPath, 'review.py'), 'video', awemeId, scriptPath],
      { cwd: contentDir, timeout: 5 * 60_000 }
    );

    const reportPath = path.join(outputDir, 'report.md');
    if (!existsSync(reportPath)) {
      throw new Error(
        `adapter 未生成 report.md\nstdout 末段: ${stdout.slice(-200)}\nstderr 末段: ${stderr.slice(-200)}`
      );
    }
    return reportPath;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    if (e.stderr) {
      throw new Error(`adapter 子进程失败: ${e.stderr.slice(-200)}`);
    }
    throw err;
  }
}
