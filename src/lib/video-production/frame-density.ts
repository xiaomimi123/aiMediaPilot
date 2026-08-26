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
/** 单格内非背景像素超过这个比例才算"这格有内容" */
const CELL_CONTENT_THRESHOLD = 0.01;

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
 * 判定阈值(2026-08-26 实测标定, 不是拍脑袋):
 *   参考视频 PPT 型     contentRatio 0.30~0.54, 九宫格 7-9 格
 *   参考视频 真人+动效  contentRatio 0.72~0.87, 九宫格 9 格
 *   我们的产出          contentRatio 0.013~0.098, 九宫格 3-9 格
 *
 * 门槛定在 0.12: 明显高于我们当前的典型值(0.05~0.10), 又远低于参考的下沿(0.30),
 * 留出余量给"故意留白的转场帧"——参考视频自己也有 0.054 的空镜, 一刀切会误伤。
 * 这是**及格线不是目标线**: 先把"整屏空白"拦掉, 逼近参考量级是后续的事。
 */
const MIN_CONTENT_RATIO = 0.12;
const MIN_CELLS_USED = 3;

export function judgeFrameDensity(m: FrameDensity): DensityJudgement {
  const pct = (m.contentRatio * 100).toFixed(1);

  if (m.contentRatio < MIN_CONTENT_RATIO) {
    return {
      ok: false,
      reason: `画面太空: 只有 ${pct}% 的面积有内容(实测 ${m.contentRatio.toFixed(3)}), 底色 ${m.background} 占了其余全部。`
        + ` 同类参考视频这个数字是 30%~54%。请把素材清单里的内容真正铺开: 多个信息区块、每块内部有小标题和要点行, 而不是居中放一句大字。`,
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
 * 整个镜头的判定 —— 按多数帧决定, 而不是任一帧不合格就打回。
 *
 * 依据: 参考视频自己也有 5.4% 占比的留白转场帧, 一刀切会把这种合理设计一并拦下,
 * 逼着模型把每一帧都塞满, 反而更糟。所以只拦"普遍性空洞": 过半取样帧都空才重写。
 * 取不到样(渲染阶段的问题)时一律放行 —— 那不是 Builder 的错。
 */
export function judgeShotDensity(samples: FrameDensity[]): DensityJudgement {
  if (samples.length === 0) return { ok: true };

  const bad = samples.filter((m) => !judgeFrameDensity(m).ok);
  if (bad.length * 2 <= samples.length) return { ok: true };

  // 拿最空的那帧当代表, 反馈才具体
  const worst = bad.reduce((a, b) => (a.contentRatio <= b.contentRatio ? a : b));
  const detail = judgeFrameDensity(worst).reason ?? '';
  return {
    ok: false,
    reason: `渲染出来的画面太空: 取样 ${samples.length} 帧, 有 ${bad.length} 帧不合格。${detail}`,
  };
}
