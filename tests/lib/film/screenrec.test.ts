import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREENREC_COMMANDS } from '@/lib/cli/commands/screenrec';
import { FILM_COMMANDS } from '@/lib/cli/commands/film';
import { FILM_ALLOWED_TOOLS, FILM_DENIED_TOOLS, FILM_RULES } from '@/lib/film-session/args';
import { isScreenrecRender, parseLog } from '@/lib/film-session/parse';
import {
  filmRenderScreenrecArgs,
  nextTrialFile,
  screenrecConfigPath,
  screenrecInvocation,
  screenrecLayout,
} from '@/lib/film/screenrec';

const root = process.cwd();
const cfg = path.join(root, 'remotion/screenrec/projects/invoify/project.config.json');
const base = { repoRoot: root, configPath: cfg, positionals: [] as string[], flags: {}, python: 'python3', node: '/usr/bin/node' };

describe('screenrec config', () => {
  it('keeps the Invoify sources, capture times, and the 1920×1146 crop', () => {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8')) as {
      formatTag: string;
      sources: Record<string, string>;
      record: { viewport: number[]; crop: { x: number; y: number; w: number; h: number } };
      shots: { kind: string }[];
    };
    expect(j.formatTag).toBe('产品录屏3D');
    expect(j.sources.stars).toBe('6.4k');
    expect(j.sources.starsApi).toBe('6383 @ 2026-11-04 17:37(UTC+8)');
    expect(j.sources.githubAt).toBe('2026-11-04 17:37(UTC+8)');
    expect(j.sources.readmeAt).toBe('2026-11-04 17:37(UTC+8)');
    expect(j.sources.recFill).toBe('2026-11-04 17:35(UTC+8)');
    expect(j.record.viewport).toEqual([1920, 1146]);
    expect(j.record.crop).toEqual({ x: 0, y: 66, w: 1920, h: 1080 });
    expect(j.shots.map((s) => s.kind)).toEqual(['hook', 'github', 'rec', 'rec', 'rec', 'readme', 'end']);
  });

  it('finds a screenrec config and leaves a chapter film alone', () => {
    expect(screenrecConfigPath(cfg)).toBe(cfg);
    expect(screenrecConfigPath(path.dirname(cfg))).toBe(cfg);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-film-'));
    fs.writeFileSync(path.join(dir, 'shots.json'), '{}');
    fs.writeFileSync(path.join(dir, 'project.config.json'), fs.readFileSync(cfg));
    expect(screenrecConfigPath(dir)).toBeNull();
    expect(screenrecConfigPath(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('does not commit secrets or voice credentials', () => {
    const dir = path.join(root, 'remotion/screenrec');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dir);
    const text = files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    expect(text).not.toMatch(/VOLC_APPID\s*=\s*\S+/);
    expect(text).not.toMatch(/VOLC_ACCESS_TOKEN\s*=\s*\S+/);
    expect(text).not.toMatch(/VOLC_SPEAKER_ID\s*=\s*\S+/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(env).toContain('# VOLC_APPID=');
    expect(env).toContain('# VOLC_ACCESS_TOKEN=');
    expect(env).toContain('# VOLC_SPEAKER_ID=');
    expect(env).not.toMatch(/VOLC_APPID=\S+/);
    expect(env).not.toMatch(/VOLC_ACCESS_TOKEN=\S+/);
    expect(env).not.toMatch(/VOLC_SPEAKER_ID=\S+/);
  });
});

describe('screenrec invocation', () => {
  it('builds record, voice, build, render, verify, and cleanup without putting env values on the command line', () => {
    process.env.VOLC_ACCESS_TOKEN = 'super-secret-token';
    const layout = screenrecLayout(root);
    const record = screenrecInvocation({ ...base, step: 'record', flags: { 'prep-only': true, only: 'fill,template' } });
    expect(record).toEqual({ cmd: '/usr/bin/node', args: [layout.scripts.record, cfg, '--prep-only', '--only=fill,template'] });
    const voice = screenrecInvocation({ ...base, step: 'voice', flags: { check: true } });
    expect(voice.args.slice(0, 3)).toEqual([layout.scripts.voice, cfg, '--check']);
    const render = screenrecInvocation({ ...base, step: 'render', flags: { keys: '0,1,4' } });
    expect(render).toEqual({ cmd: layout.tsx, args: [layout.renderTs, '--screenrec', cfg, '--keys', '0,1,4'] });
    const film = screenrecInvocation({ ...base, step: 'render', flags: { film: true } });
    expect(film.args.slice(-3)).toEqual(['--screenrec', cfg, '--film']);
    const verify = screenrecInvocation({ ...base, step: 'verify', positionals: ['out/a.mp4'], flags: { 'no-asr': true } });
    expect(verify.args[0]).toBe(layout.scripts.verify);
    expect(verify.args[2]).toBe(path.resolve('out/a.mp4'));
    expect(verify.args).toContain('--no-asr');
    const dumped = JSON.stringify([record, voice, render, film, verify, screenrecInvocation({ ...base, step: 'build' }), screenrecInvocation({ ...base, step: 'cleanup' })]);
    expect(dumped).not.toContain('super-secret-token');
    delete process.env.VOLC_ACCESS_TOKEN;
  });

  it('rejects unknown steps, mixed render flags, and a chapter-style --shots', () => {
    expect(() => screenrecInvocation({ ...base, step: 'explode' })).toThrow(/没有这一步/);
    expect(() => screenrecInvocation({ ...base, step: 'render', flags: { keys: true, film: true } })).toThrow(/--keys 或 --film/);
    expect(() => screenrecInvocation({ ...base, step: 'build', flags: { check: true } })).toThrow(/不能用/);
    expect(() => filmRenderScreenrecArgs(cfg, { shots: 'hook' })).toThrow(/不要加 --shots/);
    expect(filmRenderScreenrecArgs(cfg, { stills: true })).toEqual(['--screenrec', cfg, '--keys']);
    expect(filmRenderScreenrecArgs(cfg, {})).toEqual(['--screenrec', cfg, '--film']);
  });

  it('numbers trial files without overwriting', () => {
    const exists = (p: string) => p.endsWith('trial1_1920x1080.mp4') || p.endsWith('trial2_1920x1080.mp4');
    expect(path.basename(nextTrialFile('/tmp/films', 'Invoify', '产品录屏3D', exists))).toBe('invoify_产品录屏3D_trial3_1920x1080.mp4');
  });
});

describe('screenrec command surface', () => {
  it('is a heavy command the film session can call, and the chapter command list stays', () => {
    expect(FILM_COMMANDS.map((c) => c.path.join(' '))).toEqual(['project list', 'project export', 'film new', 'film check', 'film render', 'film register']);
    expect(SCREENREC_COMMANDS.map((c) => c.path.join(' '))).toEqual(['film screenrec']);
    expect(SCREENREC_COMMANDS[0].tier).toBe('heavy');
    expect(SCREENREC_COMMANDS[0].hermes).toBe(false);
    expect(FILM_ALLOWED_TOOLS).toContain('Bash(npm run -s mp -- film screenrec:*)');
    expect(FILM_DENIED_TOOLS).toContain('Write(remotion/screenrec/src/**)');
    expect(FILM_DENIED_TOOLS).toContain('Bash(python:*)');
    expect(FILM_RULES).toContain('产品录屏3D');
    expect(FILM_RULES).toContain('安全区不要改');
  });

  it('labels screenrec steps and does not treat them as a chapter-film checkpoint', () => {
    const line = (command: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command } }] } });
    const res = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok', is_error: false }] } });
    const done = JSON.stringify({ type: 'result', is_error: false });
    const turn = JSON.stringify({ type: 'mp_turn', message: '出产品录屏3D' });
    const screen = parseLog([turn, line('npm run -s mp -- film screenrec remotion/screenrec/projects/invoify/project.config.json render --film'), res, done]);
    expect(screen.items[1]).toEqual({ kind: 'step', text: '渲染产品录屏3D成片', ok: true });
    expect(screen.last.renderedFinal).toBe(false);
    const keys = parseLog([turn, line('npm run -s mp -- film screenrec remotion/screenrec/projects/invoify/project.config.json render --keys'), res, done]);
    expect(keys.items[1]).toMatchObject({ text: '渲染产品录屏3D关键帧' });
    const via = parseLog([turn, line('npm run -s mp -- film render remotion/screenrec/projects/invoify/project.config.json'), res, done]);
    expect(via.last.renderedFinal).toBe(false);
    expect(isScreenrecRender('npm run -s mp -- film render remotion/films/p1-v3')).toBe(false);
  });
});
