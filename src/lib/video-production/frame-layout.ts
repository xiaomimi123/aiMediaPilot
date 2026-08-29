/**
 * 竖屏版面合规检查(二十三期)。
 *
 * **为什么要检查, 而不是把话写进 prompt 就完事。**
 *
 * Builder 的 system prompt 里已经明写了两条竖屏规则:「不要左右分栏 —— 竖屏里并排
 * 两栏每栏只有 540px, 字会挤成一条」「最下面那个元素的底边落在 65%~80% 之间」。
 * 真实出片照样违反: 一帧里两栏并排, 文字挤成「U盘，插上即用，无\n需配置环境」这种
 * 折行, 而画面下半 55% 整个空着。
 *
 * 这个项目已经反复得到同一个结论: **能量出来的东西就别指望模型自觉**。密度、空壳
 * 色块两关都是这么来的, 都真的拦下过东西。版面是第三条。
 *
 * 判两条: **内容排到多低**, 以及**有没有两块内容并排**。
 *
 * **并排这条绕了两次弯路, 记下来免得重走**:
 * 1. 从像素里找竖直空档: 合成图上正常, 真实帧上两次失效。一次是背景判据用了「颜色桶
 *    精确相等」而底色是渐变的(后来修了, 见 BG_TOLERANCE); 修完仍有一帧测不出 ——
 *    那两栏之间的空档在 96 宽的分析图里只有 1 列, 而把门槛降到 1 列, 元素之间的正常
 *    间距就会被误判成并排。
 * 2. 静态查 CSS: 真实产物里 grid-template-columns 一处都没有, 并排是用**绝对定位**
 *    排出来的 —— 那等于要静态重算一遍布局, 不可行。
 * 3. **读 DOM 真实几何**: 探针本来就在 Playwright 里跑着这个页面, `getBoundingClientRect`
 *    给的是精确答案, 不需要任何启发式。绕了两圈才想到最直接的那条。
 *
 * 只判**竖屏**: 排版铺不到底在横屏不是问题。
 */

export interface FrameLayout {
  /** 内容最下沿在画面高度的百分位(0~1)。全空时为 0。 */
  bottomReach: number;
}

/**
 * 一行里有多少比例的像素算「这行有东西」—— 找内容最下沿用。
 *
 * 不能取 1%: 96 像素宽的分析图里 1% 不到 1 个像素, 背景渐变、卡片投影、JPEG 噪点
 * 都能把一行点亮。列方向上已经因为同样的原因栽过一次(空档检测完全失效)。
 * 3% 约 3 个像素, 真实的文字/图形在水平方向上至少铺得开这么宽。
 */
const ROW_CONTENT_THRESHOLD = 0.03;

/**
 * 轻微色差不算内容。**必须和 `frame-density.ts` 同一个容差**, 否则两边会对同一帧
 * 给出互相矛盾的结论。
 *
 * 一度用「颜色桶精确相等」判背景, 结果在渐变底的画面上完全失效: 背景本身跨了好几个
 * 色阶, 只有其中一个被当成背景, 其余全算成内容 —— 两张并排卡片之间明明有空档, 中段
 * 每一列却都量出 56~69 个「非背景」像素。
 */
const BG_TOLERANCE = 18;

/**
 * 量一帧的版面形状。
 *
 * 背景取出现最多的颜色 + 容差, 和 `frame-density.ts` 同一套口径 —— 两边结论要能
 * 对上, 用不同的背景判据会出现「密度说有内容、版面说全空」这种自相矛盾。
 */
export function measureFrameLayout(rgb: Buffer, width: number, height: number): FrameLayout {
  const bucket = (i: number) => `${rgb[i] >> 3},${rgb[i + 1] >> 3},${rgb[i + 2] >> 3}`;
  const count = new Map<string, number>();
  for (let i = 0; i < width * height; i++) {
    const k = bucket(i * 3);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let bgKey = '';
  let best = -1;
  for (const [k, n] of count) if (n > best) { best = n; bgKey = k; }
  // 桶心 → 实际 RGB(桶是 >>3 得来的, 乘回去再补半格)
  const bg = bgKey.split(',').map((v) => Number(v) * 8 + 4);

  const isContent = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return (
      Math.abs(rgb[i] - bg[0]) > BG_TOLERANCE ||
      Math.abs(rgb[i + 1] - bg[1]) > BG_TOLERANCE ||
      Math.abs(rgb[i + 2] - bg[2]) > BG_TOLERANCE
    );
  };

  // 最下沿: 从下往上找第一条「有东西」的扫描线
  let bottomReach = 0;
  for (let y = height - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0; x < width; x++) if (isContent(x, y)) n += 1;
    if (n / width >= ROW_CONTENT_THRESHOLD) { bottomReach = (y + 1) / height; break; }
  }

  return { bottomReach };
}

/** 内容低于这个占比的帧不判版面 —— 那是留白/转场, 归密度那一关。 */
const LAYOUT_MIN_CONTENT = 0.01;

/** 内容最下沿至少要到这里。prompt 要求 65%~85%, 判定放到 55% 留出余量。 */
const MIN_BOTTOM_REACH = 0.55;

/**
 * 内容最下沿不许越过这里 —— 再往下就压到字幕上了。
 *
 * 按字幕的**真实位置**定, 不是拍脑袋的「底部 20%」: 模板 marginV 90 + 字号 44, 在
 * 1920 高的画面上字幕占 y=1786~1830, 也就是 93%~95%。所以 90% 是它上方的安全线。
 *
 * 加这条是因为上一条(下沿至少到 55%)单独存在时被反向利用了: 模型为了「排到 80%」
 * 直接把卡片放大, 8 帧里 5 帧的下沿到了 86%~94%, 已经贴上字幕带。
 */
const MAX_BOTTOM_REACH = 0.90;

export interface LayoutJudgement {
  ok: boolean;
  reason?: string;
}

export interface LayoutSample extends FrameLayout {
  contentRatio: number;
  /**
   * 这一帧里有没有两个内容块**并排**。
   *
   * 来自浏览器里的**真实 DOM 几何**, 不是从像素里猜的。前两条路都试过并且都失败:
   * 像素找竖直空档在窄间距上失效, 静态查 CSS 又抓不到绝对定位排出来的并排。
   * 而探针本来就在 Playwright 里跑着这个页面 —— 直接读 getBoundingClientRect
   * 就是精确答案, 不需要任何启发式。
   *
   * 拿不到(旧调用方/取样失败)时当作 false, 行为与加这条之前一致。
   */
  sideBySide?: boolean;
  /**
   * 并排那两块的实际位置(px)。**光说「不要并排」模型三次都改不对**, 给出坐标之后
   * 它才知道自己错在哪 —— 这个项目里凡是反馈带上实测数字的那几关, 一次就改对了。
   */
  sidePair?: { ax: number; aw: number; bx: number; bw: number };
  /**
   * 有文字被容器裁掉。真实成片里出现过「做到平台第」—— 少了最后一个「一」。
   * 和画幅无关, 横屏竖屏都要判。
   */
  clipped?: boolean;
}

/**
 * 整镜版面判定。
 *
 * **按多数帧决定**, 和密度那一关同一个道理: 一支片子里本来就会有只放一行标题的帧,
 * 一刀切会把合理的节奏也拦下, 逼模型把每一帧都塞满, 反而更糟。
 */
export function judgeShotLayout(
  samples: LayoutSample[],
  frame: { width: number; height: number },
): LayoutJudgement {
  const meaningful = samples.filter((s) => s.contentRatio >= LAYOUT_MIN_CONTENT);
  if (meaningful.length === 0) return { ok: true };

  // 文字被裁和画幅无关, 所以放在竖屏判据之前
  const clipped = meaningful.filter((s) => s.clipped);
  if (clipped.length * 2 > meaningful.length) {
    return {
      ok: false,
      reason:
        '有文字被容器裁掉了 —— 真实成片里出现过「做到平台第」这种少一个字的画面。' +
        '把容器放宽、或者把字号调小、或者让文字换行, 但不要让它溢出。',
    };
  }

  if (frame.height <= frame.width) return { ok: true };

  const side = meaningful.filter((s) => s.sideBySide);
  if (side.length * 2 > meaningful.length) {
    const p = side.find((x) => x.sidePair)?.sidePair;
    const where = p
      ? `实测: 一块在 x=${Math.round(p.ax)} 宽 ${Math.round(p.aw)}px, 另一块在 x=${Math.round(p.bx)} 宽 ${Math.round(p.bw)}px, 两块在同一水平线上。`
      : '';
    return {
      ok: false,
      reason:
        `这是竖屏, 但你把两块内容并排放了。${where}` +
        `画面宽 ${frame.width}, 并排每块最多 ${Math.round(frame.width / 2)}px, 文字会挤成两三个字一行。` +
        `改成上下堆叠: 每块 width:100%, 块与块之间用 margin 隔开, 不要让任何两块的 y 区间重叠。`,
    };
  }

  const deep = meaningful.filter((s) => s.bottomReach > MAX_BOTTOM_REACH);
  if (deep.length * 2 > meaningful.length) {
    const worst = Math.max(...deep.map((s) => s.bottomReach));
    return {
      ok: false,
      reason:
        `内容一直排到画面 ${(worst * 100).toFixed(0)}% 的高度, 压到字幕上了 —— 字幕烧在 93%~95% 那一带。` +
        '把最下面那个元素收回到 85% 以内。',
    };
  }

  const shallow = meaningful.filter((s) => s.bottomReach < MIN_BOTTOM_REACH);
  if (shallow.length * 2 > meaningful.length) {
    const worst = Math.min(...shallow.map((s) => s.bottomReach));
    return {
      ok: false,
      reason:
        `内容只排到画面 ${(worst * 100).toFixed(0)}% 的高度, 下面一大片空着。` +
        '把元素摊开到 65%~80% 那条线附近 —— 拉开间距、放大字号、或者补一块内容, ' +
        '但最底下 20% 仍要留给字幕。',
    };
  }

  return { ok: true };
}
