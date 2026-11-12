import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { NUM, SANS } from './fonts';

/** browser 卡: 自绘浏览器外框 + 真实地址栏 URL, 里面是 capture.py 截的真实整页图;
 *  beats 按旁白句子时间驱动 滚动 / 缩放 / 光标移动 / 点击 / 跳页 / 标注框。 */
export type Mark = { x: number; y: number; width: number; height: number };
export type Screen = { url: string; title: string; width: number; height: number; image: string; marks: Record<string, Mark> };
export type Beat = {
  line: number; dt?: number; screen?: string; scroll?: string | number; anchor?: number; zoom?: number; focus?: string;
  cursor?: string; click?: boolean; callout?: { mark: string; text: string; place?: 'below' | 'above' | 'left' | 'right'; big?: string };
};
type Theme = { accent: string; ink: string; muted: string; bg: string };
const W = 1792, H = 800, BAR = 72, VW = W, VH = H - BAR;
const MOVE = 0.9, CUR = 0.75, FADE = 0.35;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

type View = { screen: string; left: number; top: number; S: number };
type State = { screen: string; y: number | string; anchor: number; z: number; focus?: string; cursor?: string };

function view(st: State, screens: Record<string, Screen>): View {
  const sc = screens[st.screen];
  const S = (VW / sc.width) * st.z;
  const vw = VW / S, vh = VH / S;
  const f = st.focus ? sc.marks[st.focus] : undefined;
  let left = f ? (f.width < vw * 0.85 ? f.x + f.width / 2 - vw / 2 : f.x - 60) : (sc.width - vw) / 2;
  let top: number;
  if (typeof st.y === 'string') {
    const m = sc.marks[st.y];
    top = m ? m.y - st.anchor * vh : 0;
  } else if (f && st.y === -1) top = f.y + f.height / 2 - 0.45 * vh;
  else top = st.y as number;
  left = Math.max(0, Math.min(sc.width - vw, left));
  top = Math.max(0, Math.min(sc.height - vh, top));
  return { screen: st.screen, left, top, S };
}
const lerpV = (a: View, b: View, p: number): View => ({ screen: b.screen, left: a.left + (b.left - a.left) * p, top: a.top + (b.top - a.top) * p, S: a.S + (b.S - a.S) * p });
const pt = (m: Mark) => ({ x: m.x + Math.min(m.width / 2, 140), y: m.y + m.height / 2 });
const toScreen = (v: View, x: number, y: number) => ({ x: (x - v.left) * v.S, y: (y - v.top) * v.S });

const Page: React.FC<{ sc: Screen; v: View; opacity?: number }> = ({ sc, v, opacity = 1 }) => (
  <Img src={staticFile(sc.image)} style={{ position: 'absolute', left: 0, top: 0, width: sc.width, height: sc.height, transformOrigin: '0 0', transform: `scale(${v.S}) translate(${-v.left}px, ${-v.top}px)`, opacity, maxWidth: 'none' }} />
);

const Cursor: React.FC<{ x: number; y: number; press: number }> = ({ x, y, press }) => (
  <svg width={44} height={44} viewBox="0 0 24 24" style={{ position: 'absolute', left: x - 6, top: y - 3, transform: `scale(${1 - 0.18 * press})`, transformOrigin: '6px 3px', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }}>
    <path d="M5 2 L5 20 L9.6 15.6 L12.6 22 L15.4 20.8 L12.5 14.5 L19 14.5 Z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

export const Browser: React.FC<{ beats: Beat[]; times: number[]; endSec: number; screens: Record<string, Screen>; theme: Theme; source?: string }> = ({ beats, times, endSec, screens, theme, source }) => {
  const f = useCurrentFrame();
  const t = f / 30;
  // 逐拍展开状态(继承上一拍)
  const states: State[] = [];
  beats.forEach((b, i) => {
    const prev: State = states[i - 1] ?? { screen: b.screen ?? Object.keys(screens)[0], y: 0, anchor: 0.3, z: 1 };
    const screenChanged = b.screen && b.screen !== prev.screen;
    const s: State = { ...prev, screen: b.screen ?? prev.screen };
    if (screenChanged) { s.z = 1; s.focus = undefined; s.y = 0; }
    if (b.zoom !== undefined) s.z = b.zoom;
    if (b.focus !== undefined) { s.focus = b.focus; if (b.scroll === undefined) s.y = -1; }
    else if (b.zoom === 1) s.focus = undefined;
    if (b.scroll !== undefined) { s.y = b.scroll; s.anchor = b.anchor ?? 0.3; }
    if (b.cursor !== undefined) s.cursor = b.cursor;
    states.push(s);
  });
  const views = states.map((s) => view(s, screens));
  let k = 0;
  for (let i = 0; i < beats.length; i++) if (t >= times[i]) k = i;
  const first = times[0] <= 0.05; // 第一拍在 0 秒 = 初始画面, 不做过渡
  const pv = k === 0 ? views[0] : views[k - 1];
  const p = k === 0 && first ? 1 : ease(Math.min(1, Math.max(0, (t - times[k]) / MOVE)));
  const sameScreen = pv.screen === views[k].screen;
  const v = sameScreen ? lerpV(pv, views[k], p) : views[k];
  const fade = sameScreen ? 1 : Math.min(1, (t - times[k]) / FADE);
  const sc = screens[v.screen];

  // 光标
  const curOf = (i: number, vv: View) => {
    const st = states[i]; const m = st.cursor ? screens[st.screen].marks[st.cursor] : undefined;
    if (!m) return { x: VW * 0.62, y: VH * 0.62 };
    const q = pt(m); return toScreen(vv, q.x, q.y);
  };
  const cTo = curOf(k, v);
  const cFrom = k === 0 ? { x: VW * 0.62, y: VH * 0.7 } : curOf(k - 1, sameScreen ? v : pv);
  const cp = ease(Math.min(1, Math.max(0, (t - times[k]) / CUR)));
  const cursorChanged = k > 0 && states[k].cursor !== states[k - 1].cursor;
  const cur = cursorChanged || k === 0 ? { x: cFrom.x + (cTo.x - cFrom.x) * cp, y: cFrom.y + (cTo.y - cFrom.y) * cp } : cTo;
  // 点击
  let press = 0, ripple: { x: number; y: number; r: number } | null = null;
  beats.forEach((b, i) => {
    if (!b.click) return;
    const tc = times[i] + CUR;
    const d = t - tc;
    if (d >= 0 && d < 0.5) { press = d < 0.15 ? 1 : 0; ripple = { ...curOf(i, i === k ? v : views[i]), r: d / 0.5 }; }
  });
  // 标注: 从该拍 +0.45s 起, 到镜头再动(滚动/缩放/跳页)为止
  const moves = (i: number) => beats[i].scroll !== undefined || beats[i].zoom !== undefined || beats[i].focus !== undefined || (beats[i].screen !== undefined && beats[i].screen !== states[i - 1]?.screen);
  const callouts = beats.map((b, i) => {
    if (!b.callout) return null;
    let end = endSec;
    for (let j = i + 1; j < beats.length; j++) if (moves(j)) { end = times[j]; break; }
    const a = t - times[i] - 0.45;
    if (a < 0 || t >= end || states[i].screen !== v.screen) return null;
    const m = screens[states[i].screen].marks[b.callout.mark];
    if (!m) return null;
    const o = Math.min(1, a / 0.25);
    const r0 = toScreen(v, m.x, m.y); const r = { x: r0.x - 8, y: r0.y - 6, w: m.width * v.S + 16, h: m.height * v.S + 12 };
    const place = b.callout.place ?? 'below';
    const big = typeof b.callout.big === 'string' ? b.callout.big : '';
    const lab: React.CSSProperties = { position: 'absolute', whiteSpace: 'nowrap', padding: '12px 26px', borderRadius: 6, background: theme.accent, color: '#fff', fontSize: 36, fontWeight: 900, fontFamily: SANS, boxShadow: '0 10px 30px rgba(60,30,0,.25)', display: 'flex', alignItems: 'baseline', gap: 16 };
    if (place === 'below') Object.assign(lab, { left: Math.max(16, Math.min(r.x, VW - 760)), top: Math.min(r.y + r.h + 14, VH - 80) });
    if (place === 'above') Object.assign(lab, { left: Math.max(16, Math.min(r.x, VW - 760)), top: Math.max(10, r.y - 78) });
    if (place === 'left') Object.assign(lab, { right: Math.max(16, VW - r.x + 16), top: Math.max(10, r.y + r.h / 2 - 34) });
    const estW = (big ? big.length * 44 + 16 : 0) + Array.from(b.callout.text).reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? 36 : 21), 0) + 48;
    if (place === 'right') Object.assign(lab, { left: Math.min(r.x + r.w + 18, VW - estW - 16), top: r.x + r.w + 18 + estW > VW - 16 ? Math.min(r.y + r.h + 14, VH - 80) : Math.max(10, r.y + r.h / 2 - 34) });
    return (
      <React.Fragment key={i}>
        <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, border: `5px solid ${theme.accent}`, borderRadius: 10, boxShadow: `0 0 0 9999px rgba(30,24,14,${0.16 * o})`, opacity: o }} />
        <div style={{ ...lab, opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>{big && <span style={{ fontFamily: NUM, fontSize: 72, fontWeight: 900, lineHeight: 1, letterSpacing: -2 }}>{big}</span>}<span>{b.callout.text}</span></div>
      </React.Fragment>
    );
  });
  const url = sc.url.replace(/^https:\/\//, '');
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff' }}>
      {/* 外框: 标签栏 + 地址栏 */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: BAR, background: '#F3EBE0', borderBottom: '1px solid #141414', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', fontFamily: SANS }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((x) => <div key={x} style={{ width: 14, height: 14, borderRadius: 7, background: x }} />)}
        <div style={{ color: '#6E675E', fontSize: 26, fontWeight: 700, margin: '0 8px 0 12px', letterSpacing: 2 }}>‹ ›</div>
        <div style={{ flex: 1, height: 44, borderRadius: 22, background: '#fff', border: '1px solid #E0D5C6', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', color: '#141414', fontSize: 24, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)' }}>
          <svg width="16" height="20" viewBox="0 0 16 20"><rect x="1" y="8" width="14" height="11" rx="2" fill="#6E675E" /><path d="M4 8V5a4 4 0 0 1 8 0v3" stroke="#6E675E" strokeWidth="2" fill="none" /></svg>
          <span><span style={{ color: '#141414', fontWeight: 700 }}>{url.split('/')[0]}</span><span style={{ color: '#6E675E' }}>/{url.split('/').slice(1).join('/')}</span></span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: BAR, width: VW, height: VH, overflow: 'hidden', background: '#fff' }}>
        {!sameScreen && fade < 1 && <Page sc={screens[pv.screen]} v={pv} />}
        <Page sc={sc} v={v} opacity={sameScreen ? 1 : fade} />
        {callouts}
        {ripple && <div style={{ position: 'absolute', left: ripple!.x - 50 * ripple!.r - 10, top: ripple!.y - 50 * ripple!.r - 10, width: 100 * ripple!.r + 20, height: 100 * ripple!.r + 20, borderRadius: '50%', border: `5px solid ${theme.accent}`, opacity: 1 - ripple!.r }} />}
        <Cursor x={cur.x} y={cur.y} press={press} />
        {source && <div style={{ position: 'absolute', left: 18, bottom: 16, padding: '8px 18px', borderRadius: 6, background: 'rgba(255,255,255,.94)', borderLeft: `6px solid ${theme.accent}`, boxShadow: '0 4px 14px rgba(0,0,0,.12)', color: '#141414', fontWeight: 600, fontSize: 24, fontFamily: SANS }}>{source}</div>}
      </div>
    </div>
  );
};
