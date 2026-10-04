/** 风格 C · 极客手账。所有数值以 spec §4.1 为准, 改这里即改全部片子。 */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bg: '#F6F7F9',
  grid: '#E3E7EE',
  ink: '#0F172A',
  muted: '#64748B',
  accent: '#2563EB',
  accentSoft: '#EEF2FF',
  accentInk: '#1E3A8A',
  marker: '#FDE68A',
  card: '#FFFFFF',
} as const;

export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
export const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

type Rect = { left: number; top: number; width: number; height: number };
/**
 * 抖音全屏播放时盖在画面上的三块(按 1080×1920 折算, 取"铺满裁两边"与"居中留黑"两种显示方式的并集):
 * 顶部频道栏、右侧头像/点赞/评论/收藏/分享一列、底部作者名与文案。重要内容不能放进这三块。
 */
export const DOUYIN_OVERLAYS: Record<'topTabs' | 'rightActions' | 'bottomCaption', Rect> = {
  topTabs: { left: 0, top: 0, width: W, height: 300 },
  rightActions: { left: 860, top: 840, width: W - 860, height: 900 },
  bottomCaption: { left: 0, top: 1590, width: W, height: H - 1590 },
};

type Zones = { pip: Rect; title: Rect; content: Rect; captions: Rect };

export const ZONE: Zones = {
  pip: { left: W - 60 - 350, top: 300, width: 350, height: 470 },
  title: { left: 60, top: 300, width: 590, height: 470 },
  content: { left: 60, top: 790, width: 790, height: 560 },
  captions: { left: 60, top: 1380, width: 790, height: 120 },
};

export type Orientation = 'portrait' | 'landscape';

/** 横版 1920×1080: 通用 16:9 安全区(平台未定) —— 顶部标题栏/暂停浮层、底部进度条/控件、左右边距 */
const LW = 1920;
const LH = 1080;
export const LANDSCAPE_OVERLAYS: Record<'top' | 'bottom' | 'left' | 'right', Rect> = {
  top: { left: 0, top: 0, width: LW, height: 120 },
  bottom: { left: 0, top: 1005, width: LW, height: LH - 1005 },
  left: { left: 0, top: 0, width: 96, height: LH },
  right: { left: LW - 96, top: 0, width: 96, height: LH },
};

/** 横版: 左边内容区正好 16:9(录屏等比铺满不裁), 右栏上小窗下段落标题, 字幕在内容区下方 */
export const LANDSCAPE_ZONE: Zones = {
  content: { left: 96, top: 120, width: 1360, height: 765 },
  pip: { left: 1488, top: 120, width: 336, height: 448 },
  title: { left: 1488, top: 568, width: 336, height: 317 },
  captions: { left: 96, top: 905, width: 1360, height: 100 },
};

export const LAYOUT: Record<Orientation, { W: number; H: number; ZONE: Zones; OVERLAYS: Record<string, Rect> }> = {
  portrait: { W, H, ZONE, OVERLAYS: DOUYIN_OVERLAYS },
  landscape: {
    W: LW,
    H: LH,
    ZONE: LANDSCAPE_ZONE,
    OVERLAYS: LANDSCAPE_OVERLAYS,
  },
};

/** 没写或写错的版式一律按竖版(旧片子 data.json 没有 orientation) */
export const layoutFor = (o: unknown) => (o === 'landscape' ? LAYOUT.landscape : LAYOUT.portrait);
