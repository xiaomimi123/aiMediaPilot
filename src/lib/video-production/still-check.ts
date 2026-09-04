/**
 * 画面体检的像素判据 —— Remotion `renderStill` 取帧版(三十期 Task 1)。
 *
 * **这是一次搬家, 不是重写。** `frame-density.ts`/`frame-detail.ts` 里的判据函数
 * 本身是纯像素逻辑(输入一段 RGB 缓冲区, 输出判定结果), 从来没有依赖 Playwright/DOM——
 * 依赖 DOM 的是那两个文件*之外*的取帧步骤(`shot-renderer.ts` 用 Playwright 截图 +
 * 浏览器内 canvas 解码)。旧渲染架构验收通过后即将成建制删除(见
 * `docs/superpowers/specs/2026-08-31-remotion-migration-design.md` §四/§六),
 * 判据本身在 spec §四的处置表里是"保留, 只换取帧方式", 所以先把这部分原样搬到新家,
 * 旧文件本身按计划不动(留给 Task 3 一并删除)。
 *
 * 下面这些函数与其阈值/标定注释逐字抄自 `frame-density.ts`/`frame-detail.ts`
 * (2026-08-29 第三次标定的版本) —— **改动阈值前请先看那两个文件的标定历史**,
 * 这里不重复踩坑。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

export interface FrameDensity {
  /** 非背景色像素占整帧的比例 */
  contentRatio: number;
  /** 九宫格里含内容的格数(该格 >1% 像素非背景) */
  cellsUsed: number;
  /** 实测出的背景色, 便于反馈里说清"底色是什么" */
  background: string;
}

export interface DensityJudgement {
  ok: boolean;
  reason?: string;
}

/** 轻微色差(抗锯齿/渐变噪点)不算内容, 否则纯色帧也会被判成有东西。 */
const BG_TOLERANCE = 18;
/**
 * 一个格子里有多少比例的内容, 才算「这格有东西」。
 *
 * 2026-08-29 随探针改成真实尺寸一起重标: 原值 0.01 也是按缩小视口定的。真实尺寸下
 * 九宫格每格是 360x640 = 23 万像素, 一行 48px 小字在它那格里只占 0.99% —— 差一点点
 * 就被判成「这格是空的」, 于是 cellsUsed = 0, 整帧被当成空屏拦下。实测踩到。
 *
 * 取 0.002: 真空屏是 0, 一行小字是 0.99%, 中间留足余量。
 */
const CELL_CONTENT_THRESHOLD = 0.002;

/**
 * 量一帧画面的"实在程度"(二十一期)。
 *
 * 动因: Builder 是**盲写**的 —— 它写完 HTML 就结束了, 从不知道渲染出来长什么样,
 * 所以会"以为"自己排好了版, 实际渲染出来 98% 是空白。给它装上眼睛不需要多模态
 * 模型: 用确定性方法量出问题, 再用**文字**把结论喂回去, 纯文本模型完全够用。
 *
 * 只做统计不做审美判断 —— 审美没有确定性口径, 而"这帧有多空"有。
 */
export function measureFrameDensity(rgb: Buffer, width: number, height: number): FrameDensity {
  const total = width * height;
  if (total <= 0 || rgb.length < total * 3) {
    return { contentRatio: 0, cellsUsed: 0, background: '#000000' };
  }

  // 背景色 = 出现次数最多的颜色。不假设是白或黑 —— 我们的模板亮底暗底都有。
  const counts = new Map<number, number>();
  for (let i = 0; i < total; i += 1) {
    const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bgKey = 0;
  let best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgKey = k; }
  const bg = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];

  const isBg = (i: number): boolean =>
    Math.abs(rgb[i * 3] - bg[0]) <= BG_TOLERANCE &&
    Math.abs(rgb[i * 3 + 1] - bg[1]) <= BG_TOLERANCE &&
    Math.abs(rgb[i * 3 + 2] - bg[2]) <= BG_TOLERANCE;

  let contentPixels = 0;
  for (let i = 0; i < total; i += 1) if (!isBg(i)) contentPixels += 1;

  let cellsUsed = 0;
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 3; gx += 1) {
      let cellTotal = 0;
      let cellContent = 0;
      for (let y = Math.floor((gy * height) / 3); y < Math.floor(((gy + 1) * height) / 3); y += 1) {
        for (let x = Math.floor((gx * width) / 3); x < Math.floor(((gx + 1) * width) / 3); x += 1) {
          cellTotal += 1;
          if (!isBg(y * width + x)) cellContent += 1;
        }
      }
      if (cellTotal > 0 && cellContent / cellTotal > CELL_CONTENT_THRESHOLD) cellsUsed += 1;
    }
  }

  return {
    contentRatio: contentPixels / total,
    cellsUsed,
    background: `#${bg.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
  };
}

/**
 * 判定阈值(2026-08-29 第三次标定 —— 前两次都记在下面, 以免重犯)。
 *
 * **第一次(定 0.12)错在**: 抽的是参考视频里视觉冲击最强的几帧(30%~54%), 把峰值当
 * 成了普遍水平。参考片自己的分布其实是「少数几帧铺满真实截图 + 多数帧留白」:
 *   t=3s 标题页 5.6% / t=45s 留白转场 5.4% / t=106s 收尾 4.2% / t=20s 目录截图 39%
 * 而且高占比那几帧靠的是整块真实截图(像素天然密), 纯文字排版到不了。实测后果:
 * 模型收到「你只有 5.6%, 人家 30%」的反馈后无所适从, 越改越乱, 甚至排出纯空屏。
 *
 * **第二次(定 0.03)错在**: 那个数是在**缩小的探针视口**(160x90)下量出来的。探针
 * 后来改成按真实尺寸渲染, 同一套画面的量级整个变了 —— 一支人眼确认正常的竖屏成片,
 * 52 帧取样的内容占比中位数只有 4.7%, 而阈值 3% 就卡在中位数上, 等于在掷硬币。
 * 真实后果: 一次出片里 4 个镜头被判「三次仍未达标」, 而它们渲出来的 clip 实测都是
 * 4%~5%, 画面完全正常 —— 全是误报, 每个还白烧 3 次模型调用。
 *
 * **这一次的标定数据**(全部在真实尺寸下量, 分析图统一缩到长边 96/171):
 *   真·空屏                0.00% 占比 / 0.00% 细节
 *   一行 48px 小字          0.11% / 0.07%
 *   真实标题卡(120px 两行)   2.36% / 0.60%
 *   正常成片 52 帧          中位 4.7% / 4.2%, 5 分位 0.6% / 0.6%
 *
 * 结论: 真空屏和「任何真的渲出了东西的画面」之间是 **0 与非 0** 的区别, 不是量的
 * 区别。所以判据取得极低, 只认「几乎一条边都没有」: 内容 < 1% **且** 细节 < 0.05%。
 * 两个都要满足 —— 单看内容会把一行小字(0.11%)误伤, 单看细节会把纯色渐变放过。
 *
 * 密度是否「好看」仍然不该由这里裁决(第一次的教训), 它只负责拦「什么都没有」。
 * 「有大色块但里面是空的」是另一种病, 归 `judgeHollowCard` 管。
 */
const MIN_CONTENT_RATIO = 0.01;
/** 真空屏一条边都没有; 任何渲出来的元素都会带来边缘。 */
const MIN_DETAIL_RATIO = 0.0005;
const MIN_CELLS_USED = 1;

/**
 * @param detailRatio 同一帧的细节量(见 `measureFrameDetail`)。**不给就当作足够**,
 *   退回只看内容占比的老行为 —— 老调用方(单测、不关心细节的路径)因此零改动。
 */
export function judgeFrameDensity(m: FrameDensity, detailRatio?: number): DensityJudgement {
  const pct = (m.contentRatio * 100).toFixed(1);

  // 空屏要两个信号一起说了才算: 单看占比会误伤一行小字(实测 0.11%),
  // 单看细节会把纯色渐变放过。见上方标定说明。
  const blank = m.contentRatio < MIN_CONTENT_RATIO && (detailRatio ?? 1) < MIN_DETAIL_RATIO;
  if (blank) {
    return {
      ok: false,
      reason: `画面太空: 只有 ${pct}% 的面积有内容(实测 ${m.contentRatio.toFixed(3)}), 底色 ${m.background} 占了其余全部。`
        + ` 这基本是一张空屏 —— 大概率是动画还没入场、元素定位跑到画面外, 或者根本没渲染出内容。请检查元素初始状态与时间线覆盖范围。`,
    };
  }

  if (m.cellsUsed < MIN_CELLS_USED) {
    return {
      ok: false,
      reason: `内容过于集中: 把画面切成九宫格, 只有 ${m.cellsUsed} 格里有东西, 其余整片空着。`
        + ` 请让内容在画面上铺开(左右分栏或上下分段), 不要全挤在中间一小块。`,
    };
  }

  return { ok: true };
}

/**
 * 画面「细节量」度量(二十三期)。
 *
 * **为什么要另起一个度量, 而不是调 `measureFrameDensity`。**
 *
 * 那个量的是「和背景不同的像素占多少」。真实成片上它给出了颠倒的结论:
 *
 *   f4a: 一张几乎空的大卡片, 只在左上角写着「6 小时」  → 26.4%, 用到 6 个格子
 *   f4b: 四行文字 + 图标 + 分隔线的信息卡              → 16.8%, 用到 3 个格子
 *
 * 空卡片排得比有内容的还高 —— 因为一块纯色大色块就能把「非背景像素」撑起来。
 * 拿这个数去调 Builder, 等于在教它画大色块刷分。指标一旦变成目标就不再是好指标,
 * `measureFrameDensity` 的注释里已经为另一件事记过一次同样的教训。
 *
 * 所以这里量的是**局部对比**: 一块纯色卡片的内部处处平坦, 只有边框那一圈有跳变;
 * 而文字、图标、分隔线到处都是跳变。同样的面积, 有内容的那张跳变多得多。
 */
export interface FrameDetail {
  /** 有局部跳变的像素占比 —— 纯色区域不计, 不管它多大。 */
  detailRatio: number;
  /** 含有细节的网格数 —— 用来看细节是铺开的还是挤在一角。 */
  cellsWithDetail: number;
  /** 网格总数。 */
  totalCells: number;
}

/**
 * 相邻像素差多少算「跳变」。
 *
 * 取 24(255 制)是为了跨过两类噪声: 卡片的投影渐变、以及缩图时的抗锯齿灰边。
 * 低于这个值, 一块带阴影的纯色卡片会被误判成满是细节。
 */
const EDGE_THRESHOLD = 24;

/** 分布统计的网格边长(像素)。 */
const CELL = 8;

/** 一个格子里有这么多比例的细节像素, 才算「这个格子有内容」。 */
const CELL_DETAIL_THRESHOLD = 0.02;

/**
 * 量一帧的细节量。
 *
 * `rgb` 是逐像素 RGB(每像素 3 字节), 尺寸 `width` × `height`。
 * 只和右邻、下邻比较: 够抓住所有边缘, 而且一趟扫完。
 */
export function measureFrameDetail(rgb: Buffer, width: number, height: number): FrameDetail {
  const cols = Math.max(1, Math.ceil(width / CELL));
  const rows = Math.max(1, Math.ceil(height / CELL));
  const cellDetail = new Array<number>(cols * rows).fill(0);
  const cellTotal = new Array<number>(cols * rows).fill(0);

  let detail = 0;
  let total = 0;

  const at = (x: number, y: number, c: number) => rgb[(y * width + x) * 3 + c];
  const diff = (x1: number, y1: number, x2: number, y2: number) => {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(at(x1, y1, c) - at(x2, y2, c)));
    return m;
  };

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      total += 1;
      const cell = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      cellTotal[cell] += 1;
      if (diff(x, y, x + 1, y) >= EDGE_THRESHOLD || diff(x, y, x, y + 1) >= EDGE_THRESHOLD) {
        detail += 1;
        cellDetail[cell] += 1;
      }
    }
  }

  let cellsWithDetail = 0;
  for (let i = 0; i < cellDetail.length; i++) {
    if (cellTotal[i] > 0 && cellDetail[i] / cellTotal[i] >= CELL_DETAIL_THRESHOLD) cellsWithDetail += 1;
  }

  return {
    detailRatio: total > 0 ? detail / total : 0,
    cellsWithDetail,
    totalCells: cols * rows,
  };
}

/**
 * 「大色块刷分」的判定门槛。
 *
 * **判的是同一帧上占比与细节的比值, 不是绝对阈值。** 这一点和 `measureFrameDensity`
 * 那条 0.03 不同: 那个必须跟着一整套取样方法标定; 这里判的是「背离」, 背离本身
 * 就是缺陷信号, 不依赖任何绝对水平。
 *
 * **一度用过绝对阈值(细节 < 3%), 不够用**: 模型被要求「把版面排到画面 80%」之后,
 * 回应是**把卡片放大**而不是加内容 —— 一张占 70.7% 画面的大白卡, 里面只有一个徽章、
 * 一个奖杯 emoji 和一个三角形, 细节 6.7% 刚好越过 3% 那条线, 就这么混过去了。
 *
 * 比值把它们分得很开(全部来自真实帧):
 *   空壳小卡  26.0% / 1.6%  = 0.06  拦
 *   空壳大卡  70.7% / 6.7%  = 0.10  拦
 *   正常信息卡 17.7% / 5.0%  = 0.28  过
 *   同轮正常帧 24.8~49.0%    = 0.22~0.42  过
 *   满是文字的帧              = 1.0+  过
 * 0.15 这条线两边都留了足够余量。
 */
const HOLLOW_MIN_CONTENT = 0.15;
/** 细节/占比 低于这个就是「有面积没内容」。 */
const HOLLOW_MIN_RATIO = 0.15;

export interface HollowJudgement {
  ok: boolean;
  reason?: string;
}

/**
 * 这一帧是不是「一块大色块撑场面, 里面什么都没有」。
 *
 * 动因: 排版指令调完之后, 内容占比这个数确实涨了, 但抽帧一看是**一张几乎空的大
 * 灰卡片**, 只在角上写了四个字。指标数的是「和背景不同的像素」, 一块纯色大色块就
 * 能把它撑起来 —— 模型在刷分, 不是在填内容。指标一旦变成目标就不再是好指标。
 *
 * **只管这一种病**: 本来就留白的帧(占比低)不归它管, 那是密度那一关的事。
 */
export function judgeHollowCard(m: { contentRatio: number; detailRatio: number }): HollowJudgement {
  if (m.contentRatio < HOLLOW_MIN_CONTENT) return { ok: true };
  if (m.detailRatio / m.contentRatio >= HOLLOW_MIN_RATIO) return { ok: true };

  return {
    ok: false,
    reason:
      `画面被一大块纯色占着, 里面几乎是空的: 色块占了 ${(m.contentRatio * 100).toFixed(0)}% 的面积, ` +
      `但有内容的地方只有 ${(m.detailRatio * 100).toFixed(1)}%。` +
      `**把卡片放大不算把版面排开** —— 要在这块面积里放实际的文字、数据、图标, ` +
      `而不是留一个空盒子。`,
  };
}

/**
 * 分析用的取样图长边 —— 与 `shot-renderer.ts` 的 `analysisSize` 逐字段同值。
 *
 * **不能改, 除非重新标定。** 上面 `judgeFrameDensity`/`judgeHollowCard` 的阈值都是
 * 在 96x171(竖屏)/171x96(横屏)这个尺度下量出来的(见 2026-08-29 标定注释) ——
 * `renderShotStill` 抽出来的是 Remotion 合成的真实分辨率帧(比如 1080x1920), 分析前
 * 必须缩到同一尺度, 否则又是"探针改真实尺寸、阈值忘了跟着改"那次事故的重演。
 */
const ANALYSIS_LONG = 171;

/** 等比缩到长边 ANALYSIS_LONG —— 竖屏得 96x171, 横屏得 171x96。 */
export function analysisSizeFor(width: number, height: number): { width: number; height: number } {
  return height > width
    ? { width: Math.max(1, Math.round((ANALYSIS_LONG * width) / height)), height: ANALYSIS_LONG }
    : { width: ANALYSIS_LONG, height: Math.max(1, Math.round((ANALYSIS_LONG * height) / width)) };
}

/**
 * 单帧综合判定 —— 密度关 + 空壳关一起过(与旧链 worker 里对每个取样帧做的事等价,
 * 只是这里只有一帧, 不需要 `judgeShotDensity` 那层"多数帧决定"的聚合)。
 *
 * 只报不拦(spec §四): 调用方(worker)拿到 `ok:false` 只打日志, 不重渲染、不阻塞出片。
 */
export function judgeStillFrame(density: FrameDensity, detail: FrameDetail): DensityJudgement {
  const densityJudgement = judgeFrameDensity(density, detail.detailRatio);
  if (!densityJudgement.ok) return densityJudgement;
  return judgeHollowCard({ contentRatio: density.contentRatio, detailRatio: detail.detailRatio });
}

/**
 * 把 `renderShotStill` 落盘的 PNG 解码成判据要的逐像素 RGB —— 借 ffmpeg 一趟到位
 * (缩放 + 解码), 不引入 sharp/pngjs 这类新依赖(项目里其它地方读像素也是靠 ffmpeg,
 * 见 `tests/lib/video-production/_ppm-test-utils.ts` 的先例, 这里换成 `rawvideo`
 * 直出 RGB 字节, 不用再解析 PPM 头)。
 *
 * 缩放目标必须是 `analysisSizeFor` 算出来的尺寸 —— 判据阈值就是照这个尺度标定的
 * (见上方 `ANALYSIS_LONG` 注释), 传别的尺寸等于又一次"改了尺子不知道"。
 */
export async function extractStillRgb(
  pngPath: string,
  frameWidth: number,
  frameHeight: number,
): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { width, height } = analysisSizeFor(frameWidth, frameHeight);
  const { stdout } = await execFileAsync(
    FFMPEG_BIN,
    ['-y', '-i', pngPath, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { timeout: 30_000, maxBuffer: 1 << 24, encoding: 'buffer' },
  );
  return { rgb: stdout as unknown as Buffer, width, height };
}

/**
 * 一步到位: 给一张 `renderShotStill` 输出的 PNG(与它的合成分辨率), 解码 + 量 +判定。
 * worker 只需要调这一个函数, 不用自己拼 `extractStillRgb`/`measureFrameDensity`/
 * `measureFrameDetail`/`judgeStillFrame` 四步。
 */
export async function judgeStillPng(
  pngPath: string,
  frameWidth: number,
  frameHeight: number,
): Promise<DensityJudgement> {
  const { rgb, width, height } = await extractStillRgb(pngPath, frameWidth, frameHeight);
  const density = measureFrameDensity(rgb, width, height);
  const detail = measureFrameDetail(rgb, width, height);
  return judgeStillFrame(density, detail);
}
