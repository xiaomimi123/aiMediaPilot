#!/usr/bin/env node
/**
 * `remotion/` 是独立的 package.json 子项目(见 remotion/package.json 顶部注释里的原因:
 * Remotion 4 依赖 React 19, 和主项目的 React 18 冲突, 混进主项目 package.json 会让
 * Next.js 构建把 React 19 和渲染器一起打进去)。
 *
 * 但 `src/lib/video-production/remotion-render.ts` 运行在主项目进程里(worker/测试都是),
 * 它需要 `import { bundle } from '@remotion/bundler'` 和 `@remotion/renderer` ——
 * Node 的模块解析只会往上找父目录的 node_modules, 不会跨到平级的 remotion/node_modules,
 * 所以这两个包必须能在主项目 node_modules 里被找到。
 *
 * 用符号链接而不是把它们写进主项目 package.json: 这样版本只有 remotion/package.json
 * 一处声明, 不会出现两份不同版本的 @remotion/bundler 各自安装、行为不一致的风险。
 * 这个脚本挂在主项目的 postinstall 里, 保证 `npm install` 之后链接总是新鲜的。
 */
import { existsSync, mkdirSync, symlinkSync, readlinkSync, unlinkSync, lstatSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remotionDir = path.join(rootDir, 'remotion');

if (!existsSync(path.join(remotionDir, 'node_modules'))) {
  console.log('[setup-remotion] remotion/node_modules 不存在, 先跑 npm install ...');
  try {
    execSync('npm install', { cwd: remotionDir, stdio: 'inherit' });
  } catch (err) {
    console.warn('[setup-remotion] remotion/ 依赖安装失败, 跳过符号链接。渲染相关功能会不可用。', err?.message);
    process.exit(0);
  }
}

const pkgsToLink = ['bundler', 'renderer'];
const targetScope = path.join(rootDir, 'node_modules', '@remotion');
mkdirSync(targetScope, { recursive: true });

for (const pkg of pkgsToLink) {
  const linkPath = path.join(targetScope, pkg);
  const realTarget = path.join(remotionDir, 'node_modules', '@remotion', pkg);
  if (!existsSync(realTarget)) {
    console.warn(`[setup-remotion] remotion/node_modules/@remotion/${pkg} 不存在, 跳过。`);
    continue;
  }
  const relativeTarget = path.relative(targetScope, realTarget);
  if (existsSync(linkPath) || (() => { try { lstatSync(linkPath); return true; } catch { return false; } })()) {
    try {
      const current = readlinkSync(linkPath);
      if (current === relativeTarget) continue; // 已经是最新的链接
      unlinkSync(linkPath);
    } catch {
      // linkPath 存在但不是符号链接(例如误装了真实包), 不要覆盖, 提醒用户手动处理
      console.warn(`[setup-remotion] node_modules/@remotion/${pkg} 已存在且不是符号链接, 跳过。`);
      continue;
    }
  }
  symlinkSync(relativeTarget, linkPath, 'dir');
  console.log(`[setup-remotion] 已链接 node_modules/@remotion/${pkg} -> remotion/node_modules/@remotion/${pkg}`);
}
