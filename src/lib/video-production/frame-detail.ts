/**
 * 画面「细节量」度量(二十三期)。
 *
 * **为什么要另起一个度量, 而不是调 `frame-density.ts` 那个。**
 *
 * 那个量的是「和背景不同的像素占多少」。真实成片上它给出了颠倒的结论:
 *
 *   f4a: 一张几乎空的大卡片, 只在左上角写着「6 小时」  → 26.4%, 用到 6 个格子
 *   f4b: 四行文字 + 图标 + 分隔线的信息卡              → 16.8%, 用到 3 个格子
 *
 * 空卡片排得比有内容的还高 —— 因为一块纯色大色块就能把「非背景像素」撑起来。
 * 拿这个数去调 Builder, 等于在教它画大色块刷分。指标一旦变成目标就不再是好指标,
 * `frame-density.ts` 的注释里已经为另一件事记过一次同样的教训。
 *
 * 所以这里量的是**局部对比**: 一块纯色卡片的内部处处平坦, 只有边框那一圈有跳变;
 * 而文字、图标、分隔线到处都是跳变。同样的面积, 有内容的那张跳变多得多。
 *
 * 这个模块**只负责测量, 不含阈值**。密度那边的教训是: 阈值必须和一套具体的取样
 * 方法一起标定, 分开定就会错。所以判定留给调用方, 等真正标定过再写死。
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
 * **判的是同一帧上占比与细节的比值, 不是绝对阈值。** 这一点和 `frame-density.ts`
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
