import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { execute, agentFromEnv } from '@/lib/cli/registry';
import { ALL_COMMANDS } from '@/lib/cli';

/**
 * MediaPilot 命令行: 给人(中文)、给 Claude Code / Hermes(--json)用。
 * 命令定义在 src/lib/cli/; 说明见 .claude/skills/mediapilot/SKILL.md 与 produce-film skill。
 */
async function main(): Promise<number> {
  const r = await execute(ALL_COMMANDS, process.argv.slice(2), { agent: agentFromEnv({ MP_AGENT: process.env.MP_AGENT }) }, { db: prisma });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.stdout) process.stdout.write(r.stdout);
  return r.exitCode;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (e) => {
    process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
