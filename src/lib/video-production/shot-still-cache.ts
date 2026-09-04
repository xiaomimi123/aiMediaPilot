import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderShotStill, type FilmInput } from './remotion-render';

/**
 * 剪辑台「每镜卡面图」的渲染+缓存层(三十一期 Task 3)。
 *
 * 与路由层(`shot-still/[shotIndex]/route.ts`)分开是为了让「渲染+缓存+孤儿清理」
 * 这套逻辑能脱离 Next.js 的 Request/Response 独立做真渲染测试——`renderShotStill`
 * 本身是真跑一次 Remotion(bundle 已缓存但渲染不是), 混进路由层测试会逼真渲染测试
 * 也要经过 mock 掉的 prisma/getOrCreateDefaultUser 那层, 徒增噪音。
 *
 * **卡面 still 不挂载出镜视频**(cutaway/pip 两种版式都不传 `sourceVideo`/
 * `sourceVideoFile`, 调用方也不必再传 `sourceVideoFile` 进来)——这是本任务的关键
 * 视觉等价判断, 不是漏做:
 * - cutaway 版式: 卡片在自己的时间窗内是**全幅不透明**的(`Film.tsx` 里卡片盖住
 *   整个画面), 窗口内根本看不到底下的出镜视频, 有没有挂载视频层对这一帧的像素
 *   毫无影响。
 * - pip 版式: 卡片才是**主画面**, 浮窗里显示的是出镜视频, 而剪辑台调的是卡片
 *   内容(槽位文字), 不是浮窗——浮窗即使渲上去也不是剪辑台在编辑的东西, 渲了反而
 *   要多付一份把出镜视频(实测 358MB 量级)拷进渲染资产目录的成本。
 *
 * 省掉这层之后, 卡面接口不需要访问 `vp.sourceVideoPath`, 也就不需要为它另起
 * 一次大文件拷贝——这是本任务刻意换来的性能收益, 不是遗漏。
 */

export type ShotStillCacheOpts = {
  /** 缓存目录, 调用方传 `path.join(productionRoot, 'stills')`。 */
  stillsDir: string;
  shotIndex: number;
  /** 该镜在 `FilmPlan.shots` 里的原始 JSON(未做任何裁剪)——参与 hash。 */
  shot: unknown;
  aspect: '16:9' | '9:16';
  visualStyle: 'card' | 'illustration';
};

/**
 * 缓存文件名 = `<shotIndex>-<hash>.png`。
 *
 * 前缀带 `shotIndex` 是为了让孤儿清理知道"同一镜的旧文件长什么样"——hash 本身
 * 不包含 shotIndex(镜内容变了 hash 才应该变, shotIndex 只是这一镜在数组里的
 * 位置, 与内容无关), 所以清理时按文件名前缀匹配, 不是按 hash 前缀匹配。
 *
 * hash 只取该镜 shot 的 JSON + visualStyle + aspect——这三者任一变化都应该让
 * 卡面失效重渲: shot 变了(文字/卡型/时间窗)画面自然要变; visualStyle/aspect
 * 变了是模板/交付方式换了, 同一份 shot JSON 在不同风格/画幅下渲出来的卡面也
 * 不一样。sha1 只取前 12 位十六进制——文件名不需要密码学强度, 只需要在同一个
 * `stillsDir` 里不撞车, 12 位(48 bit)对这个用途绰绰有余。
 */
export function stillCacheFileName(
  shotIndex: number,
  shot: unknown,
  aspect: '16:9' | '9:16',
  visualStyle: 'card' | 'illustration',
): string {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({ shot, visualStyle, aspect }))
    .digest('hex')
    .slice(0, 12);
  return `${shotIndex}-${hash}.png`;
}

/**
 * 进程内 in-flight 渲染去重——key 是目标缓存文件的绝对路径。
 *
 * 动因: 单用户低风险场景下, 同一镜两个请求同时 miss 本来问题不大(顶多重渲一次、
 * 写同一个文件两次), 但去重成本很低(一个 Map), 顺手做掉更干净——两次并发 miss
 * 变成一次真实渲染 + 一次等它完成, 不会有"两个 renderShotStill 同时写同一个
 * outputPath"这种没必要的竞争。
 *
 * 用一个**同步**函数(`reserveRenderTask`)做"查 Map、没有就登记"这一步——如果这步
 * 本身是 async 且中间有 await, 两个几乎同时到达的请求会都在对方登记之前查到"没有
 * 在渲", 各自登记出两个渲染任务, 去重就失效了。同步函数不会被打断, "查 + 登记"
 * 是原子的。
 */
const inFlight = new Map<string, Promise<void>>();

function reserveRenderTask(key: string, start: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = start().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function renderAndCleanup(opts: ShotStillCacheOpts, filePath: string, fileName: string): Promise<void> {
  await fs.mkdir(opts.stillsDir, { recursive: true });

  const shot = opts.shot as { startMs?: number; endMs?: number };
  const startMs = typeof shot.startMs === 'number' ? shot.startMs : 0;
  const endMs = typeof shot.endMs === 'number' ? shot.endMs : startMs;
  // 卡面取该镜时间窗**中点**一帧——与 worker `reportStillHealth` 的体检口径一致
  // (同一份"这一镜该长什么样"的判断, 剪辑台预览和体检没道理用两套取帧规则)。
  const atMs = Math.round((startMs + endMs) / 2);

  const input: FilmInput = {
    shots: [opts.shot],
    audioSrc: null,
    bgm: null,
    // 卡面预览不叠字幕——字幕时间轴是按全片对齐算出来的, 单独抽这一镜不需要还原
    // 它, 剪辑台调的是卡片内容, 不是字幕。
    captions: [],
    aspect: opts.aspect,
    visualStyle: opts.visualStyle,
    // 见文件顶部注释: cutaway/pip 两种版式的卡面都视觉等价于"不挂出镜视频"。
    sourceVideo: null,
  };

  await renderShotStill({
    input,
    shotIndex: opts.shotIndex,
    atMs,
    outputPath: filePath,
  });

  // 孤儿清理: plan 改了 → 这一镜的 hash 变了 → 旧缓存文件不会再被任何请求命中,
  // 变成孤儿。写入新文件之后, 顺手删掉同一 shotIndex 前缀、文件名不同(旧 hash)
  // 的文件——不需要 PUT 那边主动失效(见 film-plan/route.ts 里那处挂点注释的更新),
  // 缓存天然靠"没人再请求旧文件名"失效, 这里只是把磁盘上的孤儿文件顺手清掉,
  // 不做也不影响正确性, 只是节省磁盘。
  const prefix = `${opts.shotIndex}-`;
  const entries = await fs.readdir(opts.stillsDir);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix) && name !== fileName)
      .map((name) => fs.rm(path.join(opts.stillsDir, name), { force: true })),
  );
}

/**
 * 取(命中缓存或渲染)一镜卡面 PNG 的绝对路径。
 *
 * 命中: 直接返回, 不碰文件系统写入(只有一次 `fs.access` 探测)。
 * 未命中: 渲染 + 落盘 + 孤儿清理(见 `renderAndCleanup`), 完成后返回同一路径。
 */
export async function ensureShotStill(
  opts: ShotStillCacheOpts,
): Promise<{ filePath: string; hit: boolean }> {
  const fileName = stillCacheFileName(opts.shotIndex, opts.shot, opts.aspect, opts.visualStyle);
  const filePath = path.join(opts.stillsDir, fileName);

  try {
    await fs.access(filePath);
    return { filePath, hit: true };
  } catch {
    // miss, 往下渲
  }

  await reserveRenderTask(filePath, () => renderAndCleanup(opts, filePath, fileName));
  return { filePath, hit: false };
}
