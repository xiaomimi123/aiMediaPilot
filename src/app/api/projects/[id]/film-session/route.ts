import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { abandonFilm, createRunnerDeps, restartFilm, registerFilmSession, currentFilm, FilmBusy, refreshFilm, replyFilm, runningElsewhere, startFilm, stopFilm } from '@/lib/film-session/runner';
import { getFilmModel } from '@/lib/film-session/settings';
import { ShotsFileSchema } from '@/lib/film/shots';
import type { Item } from '@/lib/film-session/parse';

export const dynamic = 'force-dynamic';

export interface FilmSessionView {
  id: string;
  status: string;
  checkpoint: string | null;
  message: string | null;
  filmDir: string | null;
  version: number | null;
  createdAt: string;
  items: Item[];
  shots: { id: string; fromSec: number; toSec: number; intent: string; material: string | null }[] | null;
  previewUrl: string | null;
}
export interface FilmSessionData {
  current: FilmSessionView | null;
  history: { id: string; version: number | null; status: string; summary: string | null; createdAt: string }[];
  busyElsewhere: { projectId: string; title: string } | null;
  claudeAvailable: boolean;
  versions: number[];
  /** 版本号 → 版式(没记 = 竖版), 「改这一版」下拉里标出来 */
  orientations: Record<number, 'portrait' | 'landscape'>;
}

const model = () => getFilmModel(prisma);

async function view(projectId: string): Promise<FilmSessionData> {
  const deps = createRunnerDeps();
  const cur = await currentFilm(prisma, projectId);
  let current: FilmSessionView | null = null;
  if (cur) {
    const { session: s, parsed } = await refreshFilm(prisma, deps, cur.id);
    let shots: FilmSessionView['shots'] = null;
    if (s.filmDir) {
      const raw = await fs.readFile(path.join(process.cwd(), s.filmDir, 'shots.json'), 'utf8').catch(() => null);
      const f = raw ? ShotsFileSchema.safeParse(JSON.parse(raw)) : null;
      if (f?.success) shots = f.data.shots.map((x) => ({ id: x.id, fromSec: x.fromSec, toSec: x.toSec, intent: x.intent, material: x.material?.id ?? null }));
    }
    current = {
      id: s.id,
      status: s.status,
      checkpoint: s.checkpoint,
      message: s.message,
      filmDir: s.filmDir,
      version: s.version,
      createdAt: s.createdAt.toISOString(),
      items: parsed.items,
      shots,
      previewUrl: s.checkpoint === 'render' ? `/api/film-sessions/${s.id}/file?path=out/final.mp4&t=${s.updatedAt.getTime()}` : null,
    };
  }
  const past = await prisma.filmSession.findMany({ where: { projectId, status: { in: ['done', 'abandoned'] } }, orderBy: { createdAt: 'desc' }, take: 10 });
  const films = await prisma.projectFile.findMany({ where: { projectId, kind: 'final_mp4' }, select: { meta: true } });
  return {
    current,
    history: past.map((h) => ({ id: h.id, version: h.version, status: h.status, summary: h.summary, createdAt: h.createdAt.toISOString() })),
    busyElsewhere: await runningElsewhere(prisma, deps, projectId),
    claudeAvailable: !!deps.claudeBin,
    versions: films.map((f) => Number((f.meta as { filmVersion?: unknown } | null)?.filmVersion) || 0).filter(Boolean).sort((a, b) => b - a),
    orientations: Object.fromEntries(
      films.map((f) => {
        const m = (f.meta ?? {}) as { filmVersion?: unknown; orientation?: unknown };
        return [Number(m.filmVersion) || 0, m.orientation === 'landscape' ? 'landscape' : 'portrait'];
      }),
    ),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return ok(await view(params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; kind?: string; baseVersion?: number; note?: string; text?: string; orientation?: string };
  const deps = createRunnerDeps();
  try {
    if (b.action === 'start') await startFilm(prisma, deps, { projectId: params.id, kind: b.kind === 'revise' ? 'revise' : 'new', baseVersion: b.baseVersion, note: b.note, model: await model(), orientation: b.orientation === 'landscape' ? 'landscape' : 'portrait' });
    else {
      const cur = await currentFilm(prisma, params.id);
      if (!cur) return fail('没有进行中的出片', 404);
      if (b.action === 'reply') await replyFilm(prisma, deps, cur.id, String(b.text ?? ''), await model());
      else if (b.action === 'stop') await stopFilm(prisma, deps, cur.id);
      else if (b.action === 'abandon') await abandonFilm(prisma, cur.id);
      else if (b.action === 'restart') await restartFilm(prisma, deps, cur.id, await model());
      else if (b.action === 'register') await registerFilmSession(prisma, deps, cur.id);
      else return fail('action 不对', 400);
    }
  } catch (e) {
    if (e instanceof FilmBusy) return fail(e.message, 409);
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok(await view(params.id));
}
