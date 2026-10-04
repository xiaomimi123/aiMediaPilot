import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { FilmBundle } from './bundle';
import type { ShotsFile } from './shots';
import type { FilmOrientation } from './orientation';

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

export const INDEX = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, W, H } from '../../kit';
import data from './data.json';
import { Film } from './Film';

registerRoot(() => (
  <Composition id="Film" component={Film} durationInFrames={Math.ceil(data.durationSec * FPS)} fps={FPS} width={W} height={H} />
));
`;

export const INDEX_LANDSCAPE = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, LAYOUT, OrientationProvider } from '../../kit';
import data from './data.json';
import { Film } from './Film';

/** 横版: 画框 1920×1080; 区块由 OrientationProvider 传给画框与字幕, Film.tsx 不用管版式。不要改这个文件。 */
const Root: React.FC = () => (
  <OrientationProvider value="landscape">
    <Film />
  </OrientationProvider>
);

registerRoot(() => (
  <Composition id="Film" component={Root} durationInFrames={Math.ceil(data.durationSec * FPS)} fps={FPS} width={LAYOUT.landscape.W} height={LAYOUT.landscape.H} />
));
`;
const FILM = `import React from 'react';
import { Frame, Shot, Note, Kicker, fromShots } from '../../kit';
import data from './data.json';
import shots from './shots.json';
import { COPY } from './copy';

/** 镜头时间只来自 shots.json; 画面文字只来自 copy.ts(film check 会查) */
const at = fromShots(shots);

/** 由 produce-film 流程改写: 只写内容区, 画框/小窗/字幕由 Frame 负责 */
export const Film: React.FC = () => (
  <Frame video={data.video} captions={data.captions}>
    {shots.shots.map((s) => (
      <Shot key={s.id} {...at[s.id]}>
        <Note>
          <Kicker>{COPY.kicker}</Kicker>
        </Note>
      </Shot>
    ))}
  </Frame>
);
`;

const COPY_TS = `/** 画面上的所有文字放这里(film check 只在这里查数字) */
export const COPY = {
  kicker: '草稿',
};
`;

/** 骨架镜头短于这个秒数就并进相邻镜头(film check 的硬下限是 1 秒, 建议 2–8 秒) */
const SKELETON_MIN_SEC = 2;

/**
 * 按转写句子切初始镜头, 首尾相接覆盖 0 到原片结束。"先说背景"这类不到 2 秒的短句
 * 并进前一镜(第一句并进后一镜), 否则骨架本身就过不了 film check。
 */
export function skeletonShots(lines: FilmBundle['transcript'], durationSec: number): ShotsFile['shots'] {
  const segs = lines.map((l, i) => ({
    from: i === 0 ? 0 : l.startSec,
    to: i === lines.length - 1 ? durationSec : lines[i + 1].startSec,
    text: l.text,
  }));
  const out: typeof segs = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && (seg.to - seg.from < SKELETON_MIN_SEC || last.to - last.from < SKELETON_MIN_SEC)) {
      last.to = seg.to;
      last.text = `${last.text} ${seg.text}`;
    } else out.push({ ...seg });
  }
  const tail = out[out.length - 1];
  if (out.length > 1 && tail.to - tail.from < SKELETON_MIN_SEC) {
    const prev = out[out.length - 2];
    prev.to = tail.to;
    prev.text = `${prev.text} ${tail.text}`;
    out.pop();
  }
  return out.map((seg, i) => ({ id: `s${i + 1}`, fromSec: seg.from, toSec: seg.to, intent: seg.text }));
}

export async function scaffoldFilm(bundle: FilmBundle, version: number, root = filmsRoot(), opts: { orientation?: FilmOrientation } = {}): Promise<string> {
  const landscape = opts.orientation === 'landscape';
  if (!bundle.video) throw new Error('这个项目还没有口播视频');
  if (!(await exists(bundle.video.path))) throw new Error(`口播原片文件不在了：${bundle.video.path}（先在「口播」一步重新上传）`);
  const dir = path.join(root, `${bundle.project.id}-v${version}`);
  if (await exists(dir)) throw new Error(`片子目录已存在：${dir}`);
  // 先建在临时目录, 全部成功后再改名; 中途失败不留半截目录(否则下次 film new 会跳过这个版本号)
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(path.join(tmp, 'public'), { recursive: true });
    const videoFile = `raw${bundle.video.ext}`;
    await linkOrCopy(bundle.video.path, path.join(tmp, 'public', videoFile));
    const materials = [];
    const missingMaterials = [];
    for (const m of bundle.materials) {
      if (!(await exists(m.path))) {
        // 素材丢失: 跳过并注明(spec §6), 不让整次建片失败
        missingMaterials.push({ id: m.id, originalName: m.originalName });
        continue;
      }
      const file = `m-${m.id}${m.ext}`;
      await linkOrCopy(m.path, path.join(tmp, 'public', file));
      materials.push({ id: m.id, file, mediaType: m.mediaType, durationSec: m.durationSec, note: m.note, originalName: m.originalName });
    }
    const data = {
      projectId: bundle.project.id,
      version,
      durationSec: bundle.video.durationSec,
      video: videoFile,
      captions: bundle.transcript,
      materials,
      missingMaterials,
      ...(landscape ? { orientation: 'landscape' } : {}),
    };
    const shots: ShotsFile = { version: 1, shots: skeletonShots(bundle.transcript, bundle.video.durationSec) };
    await fs.writeFile(path.join(tmp, 'data.json'), JSON.stringify(data, null, 2));
    await fs.writeFile(path.join(tmp, 'shots.json'), JSON.stringify(shots, null, 2));
    await fs.writeFile(path.join(tmp, 'index.tsx'), landscape ? INDEX_LANDSCAPE : INDEX);
    await fs.writeFile(path.join(tmp, 'Film.tsx'), FILM);
    await fs.writeFile(path.join(tmp, 'copy.ts'), COPY_TS);
    await fs.rename(tmp, dir);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  return dir;
}
