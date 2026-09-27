import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { FilmBundle } from './bundle';
import type { ShotsFile } from './shots';

export function filmsRoot(): string {
  return process.env.FILMS_ROOT || path.join(process.cwd(), 'remotion', 'films');
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** 已登记的最大版本 +1; 若该版本目录已存在(上次没登记), 继续往后找 */
export async function nextFilmVersion(db: PrismaClient, projectId: string, root = filmsRoot()): Promise<number> {
  const films = await db.projectFile.findMany({ where: { projectId, kind: 'final_mp4' } });
  let v = films.reduce((max, f) => Math.max(max, Number((f.meta as { filmVersion?: unknown })?.filmVersion) || 0), 0) + 1;
  while (await exists(path.join(root, `${projectId}-v${v}`))) v++;
  return v;
}

/** 硬链接(同盘不占空间, 不拷 181MB); 跨盘时退回复制 */
async function linkOrCopy(src: string, dest: string) {
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
}

const INDEX = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, W, H } from '../../kit';
import data from './data.json';
import { Film } from './Film';

registerRoot(() => (
  <Composition id="Film" component={Film} durationInFrames={Math.ceil(data.durationSec * FPS)} fps={FPS} width={W} height={H} />
));
`;

const FILM = `import React from 'react';
import { Frame, Shot, Note, Kicker } from '../../kit';
import data from './data.json';
import { COPY } from './copy';

/** 由 produce-film 流程改写: 只写内容区, 画框/小窗/字幕由 Frame 负责 */
export const Film: React.FC = () => (
  <Frame video={data.video} captions={data.captions}>
    <Shot from={0} to={data.durationSec}>
      <Note>
        <Kicker>{COPY.kicker}</Kicker>
      </Note>
    </Shot>
  </Frame>
);
`;

const COPY_TS = `/** 画面上的所有文字放这里(film check 只在这里查数字) */
export const COPY = {
  kicker: '草稿',
};
`;

export async function scaffoldFilm(bundle: FilmBundle, version: number, root = filmsRoot()): Promise<string> {
  if (!bundle.video) throw new Error('这个项目还没有口播视频');
  const dir = path.join(root, `${bundle.project.id}-v${version}`);
  if (await exists(dir)) throw new Error(`片子目录已存在：${dir}`);
  await fs.mkdir(path.join(dir, 'public'), { recursive: true });

  const videoFile = `raw${bundle.video.ext}`;
  await linkOrCopy(bundle.video.path, path.join(dir, 'public', videoFile));
  const materials = [];
  for (const m of bundle.materials) {
    const file = `m-${m.id}${m.ext}`;
    await linkOrCopy(m.path, path.join(dir, 'public', file));
    materials.push({ id: m.id, file, mediaType: m.mediaType, durationSec: m.durationSec, note: m.note, originalName: m.originalName });
  }
  const data = {
    projectId: bundle.project.id,
    version,
    durationSec: bundle.video.durationSec,
    video: videoFile,
    captions: bundle.transcript,
    materials,
  };
  const shots: ShotsFile = {
    version: 1,
    shots: bundle.transcript.map((l, i) => ({
      id: `s${i + 1}`,
      fromSec: i === 0 ? 0 : l.startSec,
      toSec: i === bundle.transcript.length - 1 ? bundle.video!.durationSec : bundle.transcript[i + 1].startSec,
      intent: l.text,
    })),
  };
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify(data, null, 2));
  await fs.writeFile(path.join(dir, 'shots.json'), JSON.stringify(shots, null, 2));
  await fs.writeFile(path.join(dir, 'index.tsx'), INDEX);
  await fs.writeFile(path.join(dir, 'Film.tsx'), FILM);
  await fs.writeFile(path.join(dir, 'copy.ts'), COPY_TS);
  return dir;
}
