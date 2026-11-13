import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, MONO } from './tokens';
import './fonts';
import { captionLayout } from './text';
import type { CaptionLine } from './Captions';

/**
 * 风格 D · 章节档案(竖版 1080×1920)。和风格 C(Frame)并存, 互不影响。
 *
 * 画框: 暖白点阵纸 + 顶部章节条(章节号 · 章节名 | 署名 · 时间码) + 底部字幕(白字黑描边) + 右下警示条。
 * 人物窗会变: hero(开场/转折, 大圆角窗, 上方留标题区) ↔ circle(正文, 洋红描边圆窗, 中间或偏左)
 * ↔ off(全屏内容)。切换时 0.6 秒平滑过渡。内容区随当前形态给出, 永远不压人物窗和字幕。
 *
 * 抖音覆盖区: 顶部 300 留空; 右侧点赞列(x ≥ 860, y 840–1740)不放人物窗和字幕; 底部 1590 以下只放装饰。
 */
export const D = {
  paper: '#F4EFE6',
  dot: '#E4D9C8',
  ink: '#151515',
  muted: '#5C534C',
  pink: '#E6307F',
  pinkSoft: '#FCE4EF',
  yellow: '#FFD12E',
  card: '#FFFFFF',
  line: '#E7E0D3',
} as const;

type Rect = { left: number; top: number; width: number; height: number };

export const CHAPTER_ZONE = {
  hud: { left: 60, top: 312, width: 960, height: 48 },
  /** hero 形态: 标题区 + 大窗 */
  heroTitle: { left: 60, top: 384, width: 960, height: 270 },
  hero: { left: 150, top: 672, width: 780, height: 700 },
  /** circle 形态: 内容区在上, 圆窗在下 */
  content: { left: 60, top: 384, width: 960, height: 620 },
  /** off 形态: 内容区占满 */
  full: { left: 60, top: 384, width: 960, height: 990 },
  captions: { left: 60, top: 1396, width: 790, height: 170 },
} satisfies Record<string, Rect>;

const CIRCLE = 352;
const CIRCLE_POS: Record<'center' | 'left', Rect> = {
  // 和字幕同一条中线(字幕区 60–850, 避开右侧点赞列)
  center: { left: 455 - CIRCLE / 2, top: 1024, width: CIRCLE, height: CIRCLE },
  left: { left: 70, top: 1024, width: CIRCLE, height: CIRCLE },
};

export type PipMode = 'hero' | 'circle' | 'off';
export type PipKey = { atSec: number; mode: PipMode; pos?: 'center' | 'left' };
export type Chapter = { atSec: number; label: string };

const pipRect = (k: PipKey): Rect & { radius: number; opacity: number } => {
  if (k.mode === 'hero') return { ...CHAPTER_ZONE.hero, radius: 44, opacity: 1 };
  const c = CIRCLE_POS[k.pos ?? 'center'];
  if (k.mode === 'off') return { left: c.left + CIRCLE / 2 - 20, top: c.top + CIRCLE / 2 - 20, width: 40, height: 40, radius: 20, opacity: 0 };
  return { ...c, radius: CIRCLE / 2, opacity: 1 };
};

const current = <T extends { atSec: number }>(list: T[], t: number): [T, T | undefined] => {
  let i = 0;
  for (let k = 0; k < list.length; k++) if (t >= list[k].atSec) i = k;
  return [list[i], i > 0 ? list[i - 1] : undefined];
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** 当前形态下内容区(给 Film 里自己排版用; ChapterFrame 已经把 children 放进去了) */
export const contentZone = (mode: PipMode): Rect => (mode === 'hero' ? CHAPTER_ZONE.heroTitle : mode === 'off' ? CHAPTER_ZONE.full : CHAPTER_ZONE.content);

const tc = (sec: number) => {
  const f = Math.floor((sec % 1) * 30);
  const s = Math.floor(sec);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
};

export const ChapterFrame: React.FC<{
  video: string;
  pipFocus?: string;
  pip: PipKey[];
  chapters: Chapter[];
  /** 右上署名 */
  brand: string;
  captions: CaptionLine[];
  highlights?: string[];
  children: React.ReactNode;
}> = ({ video, pipFocus = '50% 42%', pip, chapters, brand, captions, highlights = [], children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const [key, prev] = current(pip, t);
  const p = prev ? Easing.inOut(Easing.cubic)(interpolate(t, [key.atSec, key.atSec + 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 1;
  const a = prev ? pipRect(prev) : pipRect(key);
  const b = pipRect(key);
  const r = {
    left: lerp(a.left, b.left, p),
    top: lerp(a.top, b.top, p),
    width: lerp(a.width, b.width, p),
    height: lerp(a.height, b.height, p),
    radius: lerp(a.radius, b.radius, p),
    opacity: lerp(a.opacity, b.opacity, p),
  };
  const zone = contentZone(key.mode);
  const [chapter] = current(chapters, t);
  const chapterNo = chapters.indexOf(chapter) + 1;
  const ring = key.mode === 'circle' ? D.pink : '#fff';
  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        color: D.ink,
        background: D.paper,
        backgroundImage: `radial-gradient(${D.dot} 1.15px, transparent 1.3px)`,
        backgroundSize: '28px 28px',
      }}
    >
      {/* 顶部章节条 */}
      <div style={{ position: 'absolute', ...CHAPTER_ZONE.hud, display: 'flex', alignItems: 'center', fontFamily: MONO, fontSize: 27, color: D.ink, letterSpacing: 1 }}>
        <span style={{ color: D.muted }}>{'// '}</span>
        <span style={{ fontWeight: 700 }}>{String(chapterNo).padStart(2, '0')}</span>
        <span style={{ color: D.muted, margin: '0 14px' }}>{'·'}</span>
        <span style={{ fontFamily: FONT, fontWeight: 700 }}>{chapter.label}</span>
        <div style={{ flex: 1, height: 2, background: D.line, margin: '0 24px' }} />
        <span style={{ fontWeight: 700 }}>{brand}</span>
        <span style={{ color: D.muted, marginLeft: 14 }}>{tc(t)}</span>
      </div>
      {/* 章节进度: 每章一格 */}
      <div style={{ position: 'absolute', left: 60, top: 362, width: 960, display: 'flex', gap: 8 }}>
        {chapters.map((c, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i + 1 < chapterNo ? D.ink : i + 1 === chapterNo ? D.pink : D.line }} />
        ))}
      </div>

      <div style={{ position: 'absolute', ...zone, overflow: 'hidden' }}>{children}</div>

      <div
        style={{
          position: 'absolute',
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          borderRadius: r.radius,
          opacity: r.opacity,
          overflow: 'hidden',
          border: `10px solid ${ring}`,
          boxShadow: '0 24px 60px rgba(21,21,21,0.20)',
          background: D.ink,
          boxSizing: 'border-box',
        }}
      >
        <OffthreadVideo src={staticFile(video)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pipFocus }} />
      </div>

      <ChapterCaptions lines={captions} highlights={highlights} />

      {/* 右下警示条(装饰, 落在抖音文案区也无妨) */}
      <div
        style={{
          position: 'absolute',
          left: 870,
          top: 1600,
          width: 150,
          height: 30,
          background: `repeating-linear-gradient(-45deg, ${D.ink} 0 12px, ${D.yellow} 12px 24px)`,
          borderRadius: 4,
        }}
      />
    </AbsoluteFill>
  );
};

function mark(text: string, highlights: string[]): React.ReactNode[] {
  if (!highlights.length) return [text];
  const re = new RegExp(`(${highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) =>
    highlights.includes(part) ? (
      <span key={i} style={{ color: D.yellow }}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

/** 白字黑描边字幕(不用底色块, 更轻) */
export const ChapterCaptions: React.FC<{ lines: CaptionLine[]; highlights?: string[] }> = ({ lines, highlights = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const line = lines.find((l) => t >= l.startSec && t < l.endSec);
  if (!line) return null;
  const Z = CHAPTER_ZONE.captions;
  const { fontSize, rows } = captionLayout(line.text, Z.width);
  const stroke = Math.max(4, Math.round(fontSize / 10));
  return (
    <div style={{ position: 'absolute', ...Z, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: fontSize * 1.05,
          lineHeight: 1.25,
          color: '#fff',
          textAlign: 'center',
          WebkitTextStroke: `${stroke}px ${D.ink}`,
          paintOrder: 'stroke fill',
          textShadow: `0 6px 0 ${D.ink}`,
        }}
      >
        {rows.map((row, i) => (
          <div key={i}>{mark(row, highlights)}</div>
        ))}
      </div>
    </div>
  );
};

/** 黄色小标签 */
export const Tag: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span
    style={{
      display: 'inline-block',
      background: D.yellow,
      color: D.ink,
      fontFamily: FONT,
      fontWeight: 800,
      fontSize: 34,
      padding: '8px 22px',
      borderRadius: 10,
      border: `3px solid ${D.ink}`,
      ...style,
    }}
  >
    {children}
  </span>
);

/** 洋红强调字 */
export const Pink: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ color: D.pink }}>{children}</span>;

/** 粗黑大字 */
export const headline = (size: number, extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: FONT,
  fontSize: size,
  fontWeight: 900,
  lineHeight: 1.18,
  letterSpacing: 0,
  color: D.ink,
  ...extra,
});

/** 编号卡(编号由 n 生成, 是序号不是事实数字): 白卡、右上洋红大编号、上方小标题、正文大字。可略微倾斜。 */
export const NumberCard: React.FC<{ n: number; kicker?: string; children: React.ReactNode; tilt?: number; style?: React.CSSProperties }> = ({ n, kicker, children, tilt = 0, style }) => (
  <div
    style={{
      position: 'relative',
      background: D.card,
      borderRadius: 26,
      border: `3px solid ${D.ink}`,
      boxShadow: `10px 12px 0 ${D.ink}`,
      padding: '40px 48px 44px',
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      ...style,
    }}
  >
    <div style={{ position: 'absolute', right: 36, top: 22, fontFamily: MONO, fontWeight: 800, fontSize: 64, color: D.pink }}>{String(n).padStart(2, '0')}</div>
    {kicker && <div style={{ fontFamily: FONT, fontSize: 32, color: D.muted, fontWeight: 700, marginBottom: 18 }}>{kicker}</div>}
    {children}
  </div>
);

/** 相纸: 白边图片 + 底部手写感小字, 带倾斜 */
export const Polaroid: React.FC<{ file: string; caption?: string; width: number; height: number; tilt?: number; blur?: number; fit?: 'cover' | 'contain'; style?: React.CSSProperties }> = ({
  file,
  caption,
  width,
  height,
  tilt = 0,
  blur = 0,
  fit = 'cover',
  style,
}) => (
  <div style={{ background: '#fff', padding: '16px 16px 20px', borderRadius: 10, boxShadow: '0 18px 44px rgba(21,21,21,0.22)', transform: `rotate(${tilt}deg)`, width, ...style }}>
    <div style={{ width: '100%', height, overflow: 'hidden', borderRadius: 4, background: D.ink }}>
      <Img src={staticFile(file)} style={{ width: '100%', height: '100%', objectFit: fit, filter: blur ? `blur(${blur}px)` : undefined, transform: blur ? 'scale(1.06)' : undefined }} />
    </div>
    {caption && <div style={{ fontFamily: MONO, fontSize: 26, color: D.muted, textAlign: 'center', marginTop: 12 }}>{caption}</div>}
  </div>
);
