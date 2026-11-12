// 渲染入口（转给应用已经在用的 remotion/scripts/render.ts，避免两套渲染器）:
//   node scripts/render.mjs <project.config.json> --keys [秒,...]
//   node scripts/render.mjs <project.config.json> --film [输出目录]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const tsx = path.join(repo, 'node_modules', '.bin', 'tsx');
const renderTs = path.join(repo, 'remotion', 'scripts', 'render.ts');
const cfg = process.argv[2];
const rest = process.argv.slice(3);
if (!cfg || cfg.startsWith('--') || !rest.length) {
  console.error('用法: node scripts/render.mjs <project.config.json> --keys [秒,...] | --film [输出目录]');
  process.exit(1);
}
if (!fs.existsSync(tsx)) {
  console.error('找不到 tsx，先在仓库根目录 npm install');
  process.exit(1);
}
const r = spawnSync(tsx, [renderTs, '--screenrec', path.resolve(cfg), ...rest], { cwd: repo, stdio: 'inherit' });
process.exit(r.status ?? 1);
