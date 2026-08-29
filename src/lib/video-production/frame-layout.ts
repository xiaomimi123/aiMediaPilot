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
 * **只判「内容排到多低」这一条。左右分栏两条路都试过, 都抓不到, 所以不做检测器。**
 *
 * 1. 像素找空档(中间有一条竖直空档、两侧都有内容): 合成图上正常, 真实帧上两次失效。
 *    第一次是因为背景判据用了「颜色桶精确相等」, 而底色是渐变的 —— 背景本身跨好几个
 *    色阶, 只有一个被当成背景, 其余全算内容, 空档被填满(这条后来修了, 见 BG_TOLERANCE)。
 *    修完之后一帧能测出来, 另一帧仍然测不出: 那两栏之间的空档在 96 宽的分析图里只有
 *    1 列, 而把门槛降到 1 列, 元素之间的正常间距就会被误判成分栏。
 * 2. 静态查 CSS: 真实产物里 grid-template-columns 一处都没有, 并排是用**绝对定位**
 *    排出来的 —— 那等于要静态重算一遍布局, 不可行。
 *
 * 所以这条规则只留在 Builder 的 prompt 里, 没有检查兜底 —— 明说出来, 免得以为它被
 * 覆盖了。一个抓不到的检测器比没有更坏: 看起来像覆盖, 实际是假的。
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
  if (frame.height <= frame.width) return { ok: true };

  const meaningful = samples.filter((s) => s.contentRatio >= LAYOUT_MIN_CONTENT);
  if (meaningful.length === 0) return { ok: true };

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
