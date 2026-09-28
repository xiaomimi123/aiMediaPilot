import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, MONO } from './tokens';
import { shouldCountUp } from './text';

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { t: frame / fps, fps, frame };
};
const ease = (t: number, at: number, dur = 0.35) => interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/** 白色便签卡: 大部分内容的容器 */
export const Note: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, borderRadius: 36, boxShadow: '0 24px 60px rgba(15,23,42,0.10)', padding: '48px 52px', fontFamily: FONT, color: C.ink, ...style }}>
    {children}
  </div>
);

/** `// xxx` 等宽标签 */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.accent }) => (
  <div style={{ fontFamily: MONO, fontSize: 34, color, letterSpacing: 1, marginBottom: 20 }}>{'// '}{children}</div>
);

/** 大数字 + 说明; value 里的数字部分从 0 滚到目标值(保留原小数位与前后缀) */
export const Stat: React.FC<{ value: string; label?: string; at?: number }> = ({ value, label, at = 0.2 }) => {
  const { t } = useT();
  const m = /^(\D*)(\d+(?:\.\d+)?)(.*)$/.exec(value);
  const p = ease(t, at, 0.8);
  let shown = value;
  // 比例/排名/年份不滚动(否则会闪出 #0、8/10 这类不存在的数)
  if (m && shouldCountUp(value)) {
    const decimals = (m[2].split('.')[1] ?? '').length;
    shown = `${m[1]}${(Number(m[2]) * p).toFixed(decimals)}${m[3]}`;
  }
  return (
    <div style={{ fontFamily: FONT, color: C.ink }}>
      <div style={{ fontSize: 200, fontWeight: 800, lineHeight: 1, color: C.accent, letterSpacing: -4 }}>{shown}</div>
      {label && <div style={{ fontSize: 56, fontWeight: 700, marginTop: 16, opacity: ease(t, at + 0.4) }}>{label}</div>}
    </div>
  );
};

/** 01 02 03 编号条, 逐条弹入 */
export const StepList: React.FC<{ items: string[]; at?: number; step?: number }> = ({ items, at = 0.2, step = 0.35 }) => {
  const { t } = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {items.map((item, i) => {
        const p = ease(t, at + i * step);
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 24,
              alignItems: 'baseline',
              background: C.accentSoft,
              color: C.accentInk,
              borderRadius: 18,
              padding: '26px 30px',
              fontFamily: MONO,
              fontSize: 44,
              opacity: p,
              transform: `translateX(${(1 - p) * 40}px)`,
            }}
          >
            <b style={{ color: C.accent }}>{String(i + 1).padStart(2, '0')}</b>
            <span style={{ fontFamily: FONT, fontWeight: 600 }}>{item}</span>
          </div>
        );
      })}
    </div>
  );
};

/** 荧光笔: 从左到右划过 */
export const Marker: React.FC<{ children: React.ReactNode; at?: number }> = ({ children, at = 0.4 }) => {
  const { t } = useT();
  const p = ease(t, at, 0.4);
  return (
    <span style={{ backgroundImage: `linear-gradient(transparent 58%, ${C.marker} 58%)`, backgroundSize: `${p * 100}% 100%`, backgroundRepeat: 'no-repeat' }}>
      {children}
    </span>
  );
};

/** 左右对比 */
export const Compare: React.FC<{ left: { title: string; lines: string[] }; right: { title: string; lines: string[] }; at?: number }> = ({ left, right, at = 0.2 }) => {
  const { t } = useT();
  const col = (side: { title: string; lines: string[] }, delay: number, strong: boolean) => (
    <div style={{ flex: 1, background: strong ? C.accent : C.card, color: strong ? '#fff' : C.ink, borderRadius: 30, padding: 40, opacity: ease(t, at + delay), boxShadow: '0 20px 50px rgba(15,23,42,0.10)' }}>
      <div style={{ fontFamily: MONO, fontSize: 32, opacity: 0.8, marginBottom: 18 }}>{side.title}</div>
      {side.lines.map((l, i) => (
        <div key={i} style={{ fontFamily: FONT, fontSize: 44, fontWeight: 700, lineHeight: 1.35 }}>{l}</div>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
      {col(left, 0, false)}
      {col(right, 0.3, true)}
    </div>
  );
};

/** 引用卡 */
export const Quote: React.FC<{ text: string; source?: string }> = ({ text, source }) => (
  <Note>
    <div style={{ fontSize: 120, lineHeight: 0.6, color: C.accent, fontFamily: 'Georgia, serif' }}>“</div>
    <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.4 }}>{text}</div>
    {source && <div style={{ fontFamily: MONO, fontSize: 30, color: C.muted, marginTop: 24 }}>{'— '}{source}</div>}
  </Note>
);

/** 向下的箭头(连接上下两块), 描画出现 */
export const Arrow: React.FC<{ at?: number }> = ({ at = 0.3 }) => {
  const { t } = useT();
  const p = ease(t, at, 0.3);
  return (
    <svg width="80" height="90" viewBox="0 0 80 90" style={{ display: 'block', margin: '12px auto' }}>
      <path d="M40 5 V70 M15 50 L40 80 L65 50" fill="none" stroke={C.accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  );
};
