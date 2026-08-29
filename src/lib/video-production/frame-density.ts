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
 * 「有大色块但里面是空的」是另一种病, 归 `frame-detail.ts` 的 judgeHollowCard 管。
 */
const MIN_CONTENT_RATIO = 0.01;
/** 真空屏一条边都没有; 任何渲出来的元素都会带来边缘。 */
const MIN_DETAIL_RATIO = 0.0005;
const MIN_CELLS_USED = 1;

/**
 * @param detailRatio 同一帧的细节量(见 frame-detail.ts)。**不给就当作足够**, 退回
 *   只看内容占比的老行为 —— 老调用方(单测、不关心细节的路径)因此零改动。
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
 * 整个镜头的判定 —— 按多数帧决定, 而不是任一帧不合格就打回。
 *
 * 依据: 参考视频自己也有 5.4% 占比的留白转场帧, 一刀切会把这种合理设计一并拦下,
 * 逼着模型把每一帧都塞满, 反而更糟。所以只拦"普遍性空洞": 过半取样帧都空才重写。
 * 取不到样(渲染阶段的问题)时一律放行 —— 那不是 Builder 的错。
 */
export function judgeShotDensity(samples: FrameDensity[], details?: number[]): DensityJudgement {
  if (samples.length === 0) return { ok: true };

  const bad = samples.filter((m, i) => !judgeFrameDensity(m, details?.[i]).ok);
  if (bad.length * 2 <= samples.length) return { ok: true };

  // 拿最空的那帧当代表, 反馈才具体
  const worst = bad.reduce((a, b) => (a.contentRatio <= b.contentRatio ? a : b));
  const detail = judgeFrameDensity(worst, details?.[samples.indexOf(worst)]).reason ?? '';
  return {
    ok: false,
    reason: `渲染出来的画面太空: 取样 ${samples.length} 帧, 有 ${bad.length} 帧不合格。${detail}`,
  };
}
