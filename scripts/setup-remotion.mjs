#!/usr/bin/env node
/**
 * `remotion/` 是独立的 package.json 子项目(见 remotion/package.json 顶部注释里的原因:
 * Remotion 4 依赖 React 19, 和主项目的 React 18 冲突; 原生 compositor 二进制和这两个包
 * 内部的动态 require 还会被 Next.js 构建的静态分析扫到, 有被误打进产物的风险, 所以故意
 * 不放进主项目 package.json 的依赖图里)。
 *
 * `src/lib/video-production/remotion-render.ts` 用 `createRequire` 从
 * `remotion/package.json` 所在目录发起解析, 直接找 `remotion/node_modules` 里的
 * `@remotion/bundler` / `@remotion/renderer` —— 不需要符号链接, 但前提是
 * `remotion/node_modules` 必须真实存在。这个脚本只做这一件事: 它不存在时跑一次
 * `npm install`。挂在主项目的 postinstall 里, 保证 `npm install` 之后这个前提总是满足。
 *
 * **已知代价(不阻断, 但要记下来免得变成"CI 突然变慢"的谜案)**: 多数 CI 的
 * node_modules 缓存 key 只按根目录 lockfile 算, 不会覆盖 `remotion/node_modules` ——
 * 所以每次全新 checkout 触发这里的嵌套 npm install 时, 都会重新拉 Remotion 的原生
 * compositor 二进制 + 无头 Chromium(实测约 85.4MB), 而不是从缓存命中。
 *
 * **失败必须是"渲染时才报错", 不能是"整个项目装不上"**: 这里任何异常都只
 * console.warn 后正常退出(exit 0), 绝不能让这一步的失败拖垮主项目的 `npm install`/
 * `npm ci` —— 比如只读文件系统、容器权限受限、网络不通导致嵌套 npm install 失败等。
 * 装不上的后果是后续调用 renderFilm() 时才会报错, 这比"新人 clone 下来连
 * npm install 都跑不完"轻得多。
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

try {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const remotionDir = path.join(rootDir, 'remotion');

  if (!existsSync(path.join(remotionDir, 'node_modules'))) {
    console.log('[setup-remotion] remotion/node_modules 不存在, 跑一次 npm install ...');
    execSync('npm install', { cwd: remotionDir, stdio: 'inherit' });
  }
} catch (err) {
  console.warn(
    '[setup-remotion] remotion/ 依赖安装失败, 已跳过。渲染相关功能(renderFilm/getBundle)会在' +
      '调用时报错, 但不影响主项目本次 npm install 完成。原始错误:',
    err?.message ?? err,
  );
}
