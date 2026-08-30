/**
 * 字幕的平台安全区(二十三期)。
 *
 * **动因: 我们所有的画面检查都只看画面本身, 看不见平台自己会盖掉什么。**
 *
 * 竖屏成片发到抖音, 底部会被抖音自己的 UI 占掉一条: 作者名、文案、音乐滚动条。
 * 而我们模板里的字幕 `marginV` 是 90~120 —— 在 1080x1920 上离底只有 5%~6%, 正好
 * 落在那条 UI 里, **字幕会被盖住**。这个缺陷在我们自己的成片上看不出来(画面本身
 * 完全正常), 只有发出去才会发现。
 *
 * 数字来自 video-talkcraft 那份 skill 的布局红线(「竖屏字幕 bottom 350px(避 UI)」)。
 * 它的做法值得照搬的地方不是这个数, 而是**把布局红线写成可执行的数字并注明依据** ——
 * 我们原来的 marginV 是拍脑袋来的, 没人说得出为什么是 90。
 *
 * 按**比例**存而不是写死 350: 换个竖屏分辨率(720x1280 等)那个像素值就不对了。
 */

/**
 * 竖屏时平台底部 UI 大约占画面高度的多少。
 *
 * 0.182 = 350 / 1920 —— 从那条经过实测的红线反推出来的比例。抖音竖屏底部的
 * 作者名 + 文案 + 音乐条大致就是这个量级。
 */
export const PLATFORM_UI_BOTTOM_RATIO = 350 / 1920;

/** 横屏没有这个问题(视频播放器的控件是悬浮的, 不常驻), 保留原来的小边距。 */
const LANDSCAPE_MARGIN = 100;

export interface Frame {
  width: number;
  height: number;
}

/**
 * 这个画幅下, 字幕至少要离底多远才不会被平台 UI 盖住。
 */
export function platformSafeMarginV(frame: Frame): number {
  if (frame.height <= frame.width) return LANDSCAPE_MARGIN;
  return Math.round(frame.height * PLATFORM_UI_BOTTOM_RATIO);
}

export interface ClampedMargin {
  marginV: number;
  /** 是不是被抬上去了 —— 界面要如实说明, 不能悄悄改用户的配置。 */
  raised: boolean;
  reason?: string;
}

/**
 * 把配置的 marginV 抬到安全线以上。
 *
 * **只抬不降**: 用户把字幕放得更高可能有自己的道理(比如画面下半有内容), 那不该被
 * 我们按回去。我们只保证它不会低到被平台 UI 吃掉。
 */
export function clampCaptionMargin(configured: number, frame: Frame): ClampedMargin {
  const floor = platformSafeMarginV(frame);
  if (frame.height <= frame.width || configured >= floor) {
    return { marginV: configured, raised: false };
  }
  return {
    marginV: floor,
    raised: true,
    reason:
      `字幕原本离底 ${configured}px，在 ${frame.width}×${frame.height} 竖屏上会被抖音自己的` +
      `文案和音乐条盖住，已抬到 ${floor}px。`,
  };
}
