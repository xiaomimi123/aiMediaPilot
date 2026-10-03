/**
 * 白名单真机验证(会用一点 Claude Code 额度, 用 haiku): 写 src 被拒、写片子目录允许、git status 被拒。
 * 用法: npx tsx scripts/film-perms-check.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childEnv, FILM_ALLOWED_TOOLS, resolveClaudeBin } from '../src/lib/film-session/args';

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
  { name: '写片子目录应允许', prompt: '用 Write 工具在 remotion/films/__perm_probe/x.txt 写入 x，只做这一件事。', check: () => fs.existsSync('remotion/films/__perm_probe/x.txt') },
  { name: 'git status 应被拒', prompt: '用 Bash 运行 git status，只做这一件事，把输出原样告诉我。', check: (out: string) => /permission|not allowed|denied|拒绝|haven't granted/i.test(out) },
];
let failed = 0;
for (const c of cases) {
  const r = spawnSync(bin, ['-p', c.prompt, '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--allowedTools', FILM_ALLOWED_TOOLS.join(',')], { encoding: 'utf8', timeout: 180_000, env });
  const ok = c.check(r.stdout + r.stderr);
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) failed++;
}
fs.rmSync('src/__perm_probe.txt', { force: true });
fs.rmSync(path.join('remotion/films/__perm_probe'), { recursive: true, force: true });
if (failed) {
  console.error(`${failed} 项不符合预期, 先修正 FILM_ALLOWED_TOOLS 的写法`);
  process.exit(1);
}
