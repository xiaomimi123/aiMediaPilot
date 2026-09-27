import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prisma } from '@/lib/prisma';
import { buildFilmBundle } from '@/lib/film/bundle';
import { nextFilmVersion, scaffoldFilm } from '@/lib/film/scaffold';
import { registerFilm } from '@/lib/film/register';
import { ShotsFileSchema } from '@/lib/film/shots';
import { checkShots, checkNumbers, type FilmData } from '@/lib/film/check';

/**
 * Claude Code 出片用的命令行。说明见 .claude/skills/produce-film/SKILL.md。
 * 渲染一律经这里调用 remotion/scripts/render.ts, 主项目从不 import remotion/。
 */
const ROOT = process.cwd();
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const RENDER = path.join(ROOT, 'remotion', 'scripts', 'render.ts');

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readFilm(filmDir: string) {
  const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8')) as FilmData & { projectId: string };
  const shots = ShotsFileSchema.parse(JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8')));
  return { data, shots };
}

function run(cmd: string, args: string[], cwd = ROOT): number {
  return spawnSync(cmd, args, { cwd, stdio: 'inherit' }).status ?? 1;
}

async function main() {
  const [group, cmd, ...rest] = process.argv.slice(2);

  if (group === 'project' && cmd === 'list') {
    const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
    for (const p of rows) console.log(`${p.id}\t${p.stage}\t${p.title}`);
    return;
  }
  if (group === 'project' && cmd === 'export') {
    console.log(JSON.stringify(await buildFilmBundle(prisma, rest[0]), null, 2));
    return;
  }
  if (group === 'film' && cmd === 'new') {
    const bundle = await buildFilmBundle(prisma, rest[0]);
    const version = await nextFilmVersion(prisma, rest[0]);
    console.log(await scaffoldFilm(bundle, version));
    return;
  }
  if (group === 'film' && cmd === 'check') {
    const filmDir = path.resolve(rest[0]);
    const issues: string[] = [];
    if (run('npx', ['tsc', '--noEmit', '-p', 'remotion']) !== 0) issues.push('remotion 类型检查没通过（见上方报错）');
    const { data, shots } = await readFilm(filmDir);
    const publicFiles = new Set(await fs.readdir(path.join(filmDir, 'public')));
    issues.push(...checkShots(shots, data, publicFiles));
    const p = await prisma.project.findUniqueOrThrow({ where: { id: data.projectId } });
    const scriptText = JSON.stringify(p.script ?? '');
    const copy = await fs.readFile(path.join(filmDir, 'copy.ts'), 'utf8');
    issues.push(...checkNumbers(copy, [scriptText, data.captions.map((c) => c.text).join('\n')]));
    if (issues.length) {
      for (const i of issues) console.log(`✗ ${i}`);
      process.exit(1);
    }
    console.log('film check 通过');
    return;
  }
  if (group === 'film' && cmd === 'render') {
    const filmDir = path.resolve(rest[0]);
    if (rest.includes('--stills')) {
      const { shots } = await readFilm(filmDir);
      const secs = shots.shots.map((s) => Math.round(Math.min(s.fromSec + 1.2, (s.fromSec + s.toSec) / 2) * 10) / 10);
      process.exit(run(TSX, [RENDER, filmDir, '--stills', secs.join(',')]));
    }
    await fs.mkdir(path.join(filmDir, 'out'), { recursive: true });
    process.exit(run(TSX, [RENDER, filmDir, '--out', path.join(filmDir, 'out', 'final.mp4')]));
  }
  if (group === 'film' && cmd === 'register') {
    const summary = flag(rest, '--summary');
    if (!summary) throw new Error('要写 --summary（这一版改了什么）');
    const r = await registerFilm(prisma, path.resolve(rest[0]), summary);
    console.log(`已登记成片 v${r.version}`);
    return;
  }
  console.log(`用法:
  mp project list
  mp project export <项目id>
  mp film new <项目id>
  mp film check <片子目录>
  mp film render <片子目录> [--stills]
  mp film register <片子目录> --summary <这一版改了什么>`);
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
