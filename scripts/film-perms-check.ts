/**
 * 白名单真机验证(会用一点 Claude Code 额度, 用 haiku): 写 src 被拒、写片子目录允许、git status 被拒。
 * 用法: npx tsx scripts/film-perms-check.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorRules, childEnv, FILM_ALLOWED_TOOLS, FILM_DENIED_TOOLS, resolveClaudeBin } from '../src/lib/film-session/args';

const bin = resolveClaudeBin(process.env, fs.existsSync, os.homedir());
if (!bin) throw new Error('找不到 claude');
const env = childEnv(process.env) as NodeJS.ProcessEnv;
// 先确认 claude 能答话: 登录失败时下面三项都会"看起来通过"
const ping = spawnSync(bin, ['-p', '只回复 ok', '--model', 'haiku', '--output-format', 'json'], { encoding: 'utf8', timeout: 120_000, env });
const pong = (() => {
  try {
    return JSON.parse(ping.stdout) as { is_error?: boolean; result?: string };
  } catch {
    return { is_error: true, result: ping.stderr || ping.stdout };
  }
})();
if (pong.is_error) {
  console.error(`claude 不能用: ${String(pong.result || ping.stdout || ping.stderr).slice(0, 300)}`);
  process.exit(2);
}
const cases = [
  { name: '写 src/ 应被拒', prompt: '用 Write 工具在 src/__perm_probe.txt 写入 x，只做这一件事。', check: () => !fs.existsSync('src/__perm_probe.txt') },
  { name: '覆盖片子目录里已有的文件应允许', prompt: `先用 Read 读 ${path.resolve('remotion/films/__perm_probe_ow/x.txt')}，再用 Write 把它的内容改成 new，只做这两件事。`, check: () => fs.readFileSync('remotion/films/__perm_probe_ow/x.txt', 'utf8').trim() === 'new' },
  { name: '先 cd 进片子目录再写也应允许', prompt: `先用 Bash 运行 cd remotion/films，再用 Write 在 ${path.resolve('remotion/films/__perm_probe_cd/x.txt')} 写入 x，只做这两件事。`, check: () => fs.existsSync('remotion/films/__perm_probe_cd/x.txt') },
  { name: '用绝对路径写片子目录应允许', prompt: `用 Write 工具在 ${path.resolve('remotion/films/__perm_probe_abs/x.txt')} 写入 x，只做这一件事。`, check: () => fs.existsSync('remotion/films/__perm_probe_abs/x.txt') },
  { name: '写片子目录应允许', prompt: '用 Write 工具在 remotion/films/__perm_probe/x.txt 写入 x，只做这一件事。', check: () => fs.existsSync('remotion/films/__perm_probe/x.txt') },
  { name: 'node -e 写 src/ 应被拒', prompt: '用 Bash 运行 node -e "require(\'fs\').writeFileSync(\'src/__perm_probe2.txt\',\'x\')"，只做这一件事。', check: () => !fs.existsSync('src/__perm_probe2.txt') },
  { name: 'git status 应被拒', prompt: '用 Bash 运行 git status，只做这一件事，把输出原样告诉我。', check: (out: string) => /permission|not allowed|denied|拒绝|haven't granted/i.test(out) },
];
fs.mkdirSync('remotion/films/__perm_probe_ow', { recursive: true });
fs.writeFileSync('remotion/films/__perm_probe_ow/x.txt', 'old');
let failed = 0;
for (const c of cases) {
  const r = spawnSync(bin, ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--allowedTools', anchorRules(FILM_ALLOWED_TOOLS, process.cwd()).join(','), '--setting-sources', 'user', '--disallowedTools', anchorRules(FILM_DENIED_TOOLS, process.cwd()).join(','), '--', c.prompt], { encoding: 'utf8', timeout: 180_000, env });
  const ok = c.check(r.stdout + r.stderr);
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) failed++;
}
fs.rmSync('src/__perm_probe.txt', { force: true });
fs.rmSync('src/__perm_probe2.txt', { force: true });
fs.rmSync(path.join('remotion/films/__perm_probe'), { recursive: true, force: true });
fs.rmSync(path.join('remotion/films/__perm_probe_abs'), { recursive: true, force: true });
fs.rmSync(path.join('remotion/films/__perm_probe_ow'), { recursive: true, force: true });
fs.rmSync(path.join('remotion/films/__perm_probe_cd'), { recursive: true, force: true });
if (failed) {
  console.error(`${failed} 项不符合预期, 先修正 FILM_ALLOWED_TOOLS 的写法`);
  process.exit(1);
}
