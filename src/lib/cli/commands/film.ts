import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFilmBundle } from '@/lib/film/bundle';
import { nextFilmVersion, scaffoldFilm } from '@/lib/film/scaffold';
import { registerFilm } from '@/lib/film/register';
import { ShotsFileSchema } from '@/lib/film/shots';
import { checkShots, checkNumbers, checkFilmSource, type FilmData } from '@/lib/film/check';
import { ScriptSchema } from '@/lib/script/model';
import { CliError, needArg, type Command } from '../registry';

const ROOT = process.cwd();
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const RENDER = path.join(ROOT, 'remotion', 'scripts', 'render.ts');

/** 子进程输出一律进 stderr, 保证 --json 时 stdout 干净 */
function run(cmd: string, args: string[]): number {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 2, 2] }).status ?? 1;
}

async function readFilm(filmDir: string) {
  const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8')) as FilmData & { projectId: string };
  const shots = ShotsFileSchema.parse(JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8')));
  return { data, shots };
}

export const FILM_COMMANDS: Command[] = [
  {
    path: ['project', 'list'],
    tier: 'read',
    hermes: true,
    usage: 'mp project list',
    summary: '列出项目',
    async run(ctx) {
      const rows = await ctx.db.project.findMany({ orderBy: { updatedAt: 'desc' } });
      return rows.map((p) => ({ id: p.id, stage: p.stage, title: p.title }));
    },
    format: (d) => (d as { id: string; stage: string; title: string }[]).map((p) => `${p.id}\t${p.stage}\t${p.title}`).join('\n'),
  },
  {
    path: ['project', 'export'],
    tier: 'read',
    hermes: false,
    usage: 'mp project export <项目>',
    summary: '导出出片资料包',
    run: (ctx, p) => buildFilmBundle(ctx.db, needArg(p, 0, '项目')),
    format: (d) => JSON.stringify(d, null, 2),
  },
  {
    path: ['film', 'new'],
    tier: 'heavy',
    hermes: false,
    usage: 'mp film new <项目>',
    summary: '新建片子目录',
    async run(ctx, p) {
      const id = needArg(p, 0, '项目');
      const bundle = await buildFilmBundle(ctx.db, id);
      return scaffoldFilm(bundle, await nextFilmVersion(ctx.db, id));
    },
    format: (d) => String(d),
  },
  {
    path: ['film', 'check'],
    tier: 'heavy',
    hermes: false,
    usage: 'mp film check <片子目录>',
    summary: '检查片子',
    async run(ctx, p) {
      const filmDir = path.resolve(needArg(p, 0, '片子目录'));
      const issues: string[] = [];
      // 只编译组件库 + 这一条片子: 旧版本或半成品坏了不该挡住新片子的检查
      const tsconfig = path.join(filmDir, 'tsconfig.check.json');
      await fs.writeFile(tsconfig, JSON.stringify({ extends: '../../tsconfig.json', include: ['../../kit', '.'] }, null, 2));
      if (run('npx', ['tsc', '--noEmit', '-p', tsconfig]) !== 0) issues.push('类型检查没通过（见上方报错）');
      const { data, shots } = await readFilm(filmDir);
      const missing = (data as unknown as { missingMaterials?: { originalName: string }[] }).missingMaterials ?? [];
      for (const m of missing) ctx.progress(`! 素材文件不在了，已跳过：${m.originalName}`);
      issues.push(...checkFilmSource(await fs.readFile(path.join(filmDir, 'Film.tsx'), 'utf8'), shots));
      const publicFiles = new Set(await fs.readdir(path.join(filmDir, 'public')));
      issues.push(...checkShots(shots, data, publicFiles));
      const proj = await ctx.db.project.findUniqueOrThrow({ where: { id: data.projectId } });
      // 只取稿子正文; JSON.stringify 会把段落编号 s1..s6 也算进"出处", 让 1–6 永远通过
      const parsed = ScriptSchema.safeParse(proj.script);
      const scriptText = parsed.success ? parsed.data.segments.map((x) => x.text).join('\n') : '';
      const copy = await fs.readFile(path.join(filmDir, 'copy.ts'), 'utf8');
      issues.push(...checkNumbers(copy, [scriptText, data.captions.map((c) => c.text).join('\n')]));
      if (issues.length) throw new CliError('failed', issues.map((i) => `✗ ${i}`).join('\n'));
      return { passed: true };
    },
    format: () => 'film check 通过',
  },
  {
    path: ['film', 'render'],
    tier: 'heavy',
    hermes: false,
    usage: 'mp film render <片子目录> [--stills]',
    summary: '渲染片子',
    async run(_ctx, p) {
      const filmDir = path.resolve(needArg(p, 0, '片子目录'));
      let code: number;
      if (p.flags.stills) {
        const { shots } = await readFilm(filmDir);
        const secs = shots.shots.map((s) => Math.round(Math.min(s.fromSec + 1.2, (s.fromSec + s.toSec) / 2) * 10) / 10);
        code = run(TSX, [RENDER, filmDir, '--stills', secs.join(',')]);
      } else {
        await fs.mkdir(path.join(filmDir, 'out'), { recursive: true });
        code = run(TSX, [RENDER, filmDir, '--out', path.join(filmDir, 'out', 'final.mp4')]);
      }
      if (code !== 0) throw new CliError('failed', '渲染失败（见上方输出）');
      return { rendered: true };
    },
    format: () => '渲染完成',
  },
  {
    path: ['film', 'register'],
    tier: 'heavy',
    hermes: false,
    usage: 'mp film register <片子目录> --summary <这一版改了什么>',
    summary: '登记成片',
    async run(ctx, p) {
      const summary = p.flags.summary;
      if (typeof summary !== 'string') throw new CliError('bad_args', '要写 --summary（这一版改了什么）');
      return registerFilm(ctx.db, path.resolve(needArg(p, 0, '片子目录')), summary);
    },
    format: (d) => `已登记成片 v${(d as { version: number }).version}`,
  },
];
