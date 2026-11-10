// 真实上手教学专用卡(trial2 本地副本, 不改模板): csvhook / rterm / code / stats / uses / question
import React from 'react';
import { interpolate, spring, useCurrentFrame, Easing } from 'remotion';
import { MONO, SANS } from './fonts';

export const FPS = 30;
const INK = '#141414', OR = '#FF5A1F', MUTED = '#6E675E', CREAM = '#F6F1E7';
type Rec = { dur: number; frames: { t: number; lines: string[] }[] };
export type HData = { recs: Record<string, Rec>; csv: Record<string, string[][]> };
export const HCtx = React.createContext<HData>({ recs: {}, csv: {} });
type C = { [k: string]: any; _starts: number[]; _dur: number };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const useT = () => useCurrentFrame() / FPS;
const pop = (f: number, d: number) => spring({ frame: f - d, fps: FPS, config: { damping: 14, stiffness: 180 }, durationInFrames: 18 });
const fadeUp = (f: number, d: number): React.CSSProperties => { const s = spring({ frame: f - d, fps: FPS, config: { damping: 200 }, durationInFrames: 12 }); return { opacity: s, transform: `translateY(${(1 - s) * 24}px)` }; };

export const Src: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => (
  <div style={{ position: 'absolute', left: 0, bottom: 0, padding: '7px 16px', background: 'rgba(255,255,255,.96)', borderLeft: `6px solid ${OR}`, boxShadow: '0 4px 14px rgba(0,0,0,.10)', fontSize: 22, fontWeight: 600, color: INK, fontFamily: SANS, zIndex: 20, ...style }}>{text}</div>
);
const Badge: React.FC<{ children: React.ReactNode; big?: boolean; outline?: boolean }> = ({ children, big, outline }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: big ? '10px 26px' : '8px 20px', borderRadius: 999, background: outline ? 'transparent' : OR, border: `2px solid ${outline ? INK : OR}`, color: outline ? INK : '#fff', fontSize: big ? 32 : 26, fontWeight: 800, whiteSpace: 'nowrap' }}>{children}</div>
);

// ---------- 表格 ----------
const COLS = [{ k: '#', w: 110 }, { k: 'title', w: 0 }, { k: 'price', w: 150 }, { k: 'rating', w: 130 }, { k: 'in_stock', w: 150 }];
const Row: React.FC<{ i: number; r: string[]; h: number; hi?: boolean; fs?: number }> = ({ i, r, h, hi, fs = 26 }) => (
  <div style={{ height: h, display: 'flex', alignItems: 'center', fontFamily: MONO, fontSize: fs, color: hi ? '#fff' : INK, background: hi ? OR : i % 2 ? '#FBF8F2' : '#fff', borderBottom: '1px solid #E8E1D4' }}>
    <div style={{ flex: `0 0 ${COLS[0].w}px`, paddingLeft: 18, color: hi ? '#fff' : MUTED }}>{i + 1}</div>
    <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: 16 }}>{r[0]}</div>
    <div style={{ flex: `0 0 ${COLS[2].w}px` }}>{r[1]}</div>
    <div style={{ flex: `0 0 ${COLS[3].w}px` }}>{r[2]}</div>
    <div style={{ flex: `0 0 ${COLS[4].w}px` }}>{r[3]}</div>
  </div>
);
const Head: React.FC<{ h: number; fs?: number }> = ({ h, fs = 24 }) => (
  <div style={{ height: h, display: 'flex', alignItems: 'center', fontFamily: MONO, fontSize: fs, fontWeight: 700, color: '#fff', background: INK }}>
    {COLS.map((c) => <div key={c.k} style={c.w ? { flex: `0 0 ${c.w}px`, paddingLeft: c.k === '#' ? 18 : 0 } : { flex: 1 }}>{c.k}</div>)}
  </div>
);

// ---------- 01 钩子: 真实 CSV 1000 行快速滚动 + 数字滚动 + 闪白/震屏 ----------
export const CsvHook: React.FC<{ c: C }> = ({ c }) => {
  const { csv } = React.useContext(HCtx);
  const rows = csv[c.csv] ?? [];
  const f = useCurrentFrame();
  if (!rows.length) return <div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 800, color: INK }}>缺少表格 {c.csv}</div>;
  const RH = 36, VIS = 17, N = rows.length;
  const END = 50; // 1.67s 滚到底
  const k = interpolate(f, [0, END], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.25, 1) });
  const top = k * (N - (VIS - 1)) * RH;
  const first = Math.floor(top / RH);
  const count = Math.round(interpolate(f, [0, END], [1, N], { ...clamp, easing: Easing.bezier(0.45, 0, 0.25, 1) }));
  const HIT = END + 2; // "7秒" 砸下
  const shakeAmp = (a: number, d: number) => Math.max(0, 1 - (f - a) / d) * (f >= a ? 1 : 0);
  const sh = 14 * Math.max(shakeAmp(0, 8), shakeAmp(HIT, 10));
  const sx = Math.sin(f * 2.7) * sh, sy = Math.cos(f * 3.3) * sh;
  const flash0 = interpolate(f, [0, 7], [0.55, 0], clamp);
  const flash1 = f < HIT ? 0 : interpolate(f, [HIT, HIT + 6], [0.75, 0], clamp);
  const st = pop(f, HIT - 3);
  const ring = interpolate(f, [HIT, HIT + 16], [0, 1], clamp);
  const blur = f < END ? Math.min(6, Math.abs(interpolate(f, [0, END / 2, END], [0, 1, 0], clamp)) * 6) : 0;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translate(${sx}px,${sy}px)` }}>
      {/* 表格 */}
      <div style={{ position: 'absolute', left: 0, top: 10, width: 1040, height: RH * VIS + 46 + 4, background: '#fff', border: `3px solid ${INK}`, overflow: 'hidden', boxShadow: '0 20px 50px rgba(60,40,10,.14)' }}>
        <div style={{ height: 46, background: INK, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', color: '#fff', fontFamily: MONO, fontSize: 24, fontWeight: 700 }}>
          <span style={{ width: 14, height: 14, background: OR }} />snap_1.csv<span style={{ marginLeft: 'auto', color: '#bbb', fontWeight: 400 }}>{N} rows</span>
        </div>
        <Head h={RH} fs={22} />
        <div style={{ position: 'relative', height: RH * (VIS - 1), overflow: 'hidden', filter: `blur(${blur * 0.25}px)` }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: -(top % RH) }}>
            {rows.slice(first, first + VIS + 1).map((r, j) => <Row key={first + j} i={first + j} r={r} h={RH} fs={23} hi={f >= END && first + j === N - 1} />)}
          </div>
        </div>
      </div>
      {/* 右侧大字 */}
      <div style={{ position: 'absolute', left: 1110, top: 0, right: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ alignSelf: 'flex-start' }}><Badge>{c.tag}</Badge></div>
        <div style={{ fontFamily: SANS, fontWeight: 900, color: INK, fontSize: 200, letterSpacing: -8, lineHeight: 1, marginTop: 34, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
        <div style={{ fontFamily: SANS, fontWeight: 900, color: INK, fontSize: 92, lineHeight: 1.05 }}>本书</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: MUTED, marginTop: 10 }}>书名 · 价格 · 评分 · 库存</div>
        <div style={{ position: 'relative', marginTop: 26, height: 230 }}>
          <div style={{ position: 'absolute', left: 120, top: 110, width: 10, height: 10, borderRadius: '50%', border: `${8 * (1 - ring)}px solid ${OR}`, transform: `translate(-50%,-50%) scale(${ring * 70})`, opacity: f >= HIT ? 1 - ring : 0 }} />
          <div style={{ display: 'inline-block', padding: '6px 34px', background: OR, color: '#fff', fontFamily: SANS, fontWeight: 900, fontSize: c.big2Size ?? 190, lineHeight: 1.05, letterSpacing: -4, whiteSpace: 'nowrap', transform: `rotate(-4deg) scale(${f < HIT - 3 ? 0 : 2.2 - 1.2 * st})`, opacity: f < HIT - 3 ? 0 : Math.min(1, st * 2), boxShadow: '10px 10px 0 #141414' }}>{c.big2}</div>
        </div>
      </div>
      {/* 速度线 */}
      <svg width={1920} height={1080} style={{ position: 'absolute', left: -64, top: -104, pointerEvents: 'none', opacity: interpolate(f, [0, 4, 30, 44], [1, 1, 0.6, 0], clamp) }}>
        {Array.from({ length: 34 }).map((_, i) => {
          const a = (i / 34) * Math.PI * 2 + 0.3; const r0 = 560 + ((i * 97) % 160), r1 = r0 + 160 + ((i * 53) % 220);
          const cx = 1500, cy = 470; const ph = (f * 18 + i * 40) % 300;
          return <line key={i} x1={cx + Math.cos(a) * (r0 + ph)} y1={cy + Math.sin(a) * (r0 + ph)} x2={cx + Math.cos(a) * (r1 + ph)} y2={cy + Math.sin(a) * (r1 + ph)} stroke={i % 3 ? INK : OR} strokeWidth={i % 3 ? 2 : 5} opacity={0.55} />;
        })}
      </svg>
      <div style={{ position: 'absolute', left: -64, top: -104, width: 1920, height: 1080, background: OR, opacity: flash0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: -64, top: -104, width: 1920, height: 1080, background: '#fff', opacity: flash1, pointerEvents: 'none' }} />
      <Src text={c.source} />
    </div>
  );
};

// ---------- 真实终端回放 ----------
const typedLen = (cmd: string, el: number) => Math.min(cmd.length, Math.max(0, Math.floor(el * 55)));
export const TermView: React.FC<{ s: any; el: number; fs?: number; maxLines: number; extra?: React.ReactNode }> = ({ s, el, fs = 26, maxLines, extra }) => {
  const { recs } = React.useContext(HCtx);
  const rec = recs[s.rec];
  const cmd: string = s.cmd;
  const tEnd = cmd.length / 55 + 0.25;
  const n = typedLen(cmd, el);
  const rt = Math.max(0, (el - tEnd) * (s.speed ?? 1)); // 录制里的真实秒数
  let lines: string[] = [];
  if (el >= tEnd) for (const fr of rec.frames) { if (fr.t <= rt) lines = fr.lines; else break; }
  const done = el >= tEnd && rt >= rec.dur;
  const all = [{ p: true, t: cmd.slice(0, n), cur: n < cmd.length || done }, ...lines.map((t) => ({ p: t.startsWith('$ '), t: t.startsWith('$ ') ? t.slice(2) : t, cur: false }))];
  const vis = all.slice(Math.max(0, all.length - maxLines));
  const his: RegExp[] = (s.hi ?? []).map((x: string) => new RegExp(x));
  const blink = Math.floor(el * 2.2) % 2 === 0;
  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 14, background: '#161616', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 40px rgba(60,40,10,.18)' }}>
      <div style={{ flex: '0 0 58px', background: '#262626', display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px 0 22px' }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((x) => <div key={x} style={{ width: 16, height: 16, borderRadius: 8, background: x }} />)}
        <div style={{ marginLeft: 16, fontFamily: SANS, fontSize: 22, color: '#BDBDBD', fontWeight: 600 }}>{s.win}</div>
        {el >= tEnd - 0.1 && rec.dur > 0.5 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, padding: '4px 16px', borderRadius: 8, background: done ? (s.bad ? '#C62F0A' : OR) : '#3A3A3A', color: '#fff', fontFamily: SANS }}>
            <span style={{ fontSize: 18, fontWeight: 700, opacity: 0.9 }}>{s.tag ? `${s.tag} · ` : ''}{done && s.finalNote ? s.finalNote : (s.speed ?? 1) !== 1 ? `画面 ${s.speed}× 加速 · 真实计时` : '原速 · 真实计时'}</span>
            <span style={{ fontSize: 32, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>⏱ {done && s.final ? s.final : `${Math.min(rt, rec.dur).toFixed(1)} s`}</span>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 28px', fontFamily: MONO, fontSize: fs, lineHeight: 1.4, color: '#EDEDED', whiteSpace: 'pre' }}>
        {vis.map((l, i) => {
          const h = !l.p && his.some((r) => r.test(l.t));
          return (
            <div key={i} style={{ minHeight: fs * 1.4, color: h ? (s.bad ? '#fff' : OR) : undefined, background: h && s.bad ? '#C62F0A' : undefined, fontWeight: h ? 700 : 400, margin: '0 -10px', padding: '0 10px' }}>
              {l.p && <span style={{ color: OR, fontWeight: 700 }}>$ </span>}{l.t}
              {i === vis.length - 1 && l.p && l.cur && <span style={{ background: blink || n < cmd.length ? '#EDEDED' : 'transparent' }}> </span>}
            </div>
          );
        })}
      </div>
      {false && (
        <div style={{ position: 'absolute', right: 20, top: 66, padding: '8px 20px', borderRadius: 10, background: done ? (s.bad ? '#C62F0A' : OR) : 'rgba(255,255,255,.1)', border: `2px solid ${done ? 'transparent' : '#555'}`, color: '#fff', fontFamily: SANS, textAlign: 'right' }}>
          <div style={{ fontSize: 40, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>⏱ {Math.min(rt, rec.dur).toFixed(1)} s</div>
          <div style={{ fontSize: 19, fontWeight: 700, opacity: 0.9 }}>{(s.speed ?? 1) !== 1 ? `画面 ${s.speed}× 加速 · 计时为真实秒数` : '原速回放 · 真实秒数'}</div>
        </div>
      )}
      {extra}
    </div>
  );
};

const Header: React.FC<{ title: string; badge: string; f: number; stamp?: boolean }> = ({ title, badge, f, stamp }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 24, height: 84 }}>
    <div style={{ ...fadeUp(f, 0), fontSize: 58, fontWeight: 900, color: INK, letterSpacing: -1 }}>{title}</div>
    <div style={{ ...fadeUp(f, 3), marginLeft: 'auto' }}><Badge big={stamp}>{badge}</Badge></div>
  </div>
);

export const RTerm: React.FC<{ c: C }> = ({ c }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const st = c._starts;
  const sess = (c.sessions as any[]).map((s) => ({ ...s, at: st[s.line] + (s.dt ?? 0) }));
  let cur = sess[0];
  for (const s of sess) if (t >= s.at) cur = s;
  const el = Math.max(0, t - cur.at);
  const chip = c.chip, chipAt = chip ? st[chip.line] + (chip.dt ?? 0) : 1e9;
  const cp = c.csvPanel, cpAt = cp ? st[cp.line] : 1e9;
  const { csv } = React.useContext(HCtx);
  const table = cp ? (csv[cp.csv] ?? []) : [];
  const hiRow = cp ? table[cp.hi ?? 0] : undefined;
  const csvChips: string[] = cp?.chips ?? (hiRow ? [`£${String(hiRow[1]).replace(/^£/, '')}`, `${hiRow[2]} 星`, hiRow[3] === 'True' || hiRow[3] === '有货' ? '有货' : String(hiRow[3])] : []);
  const ck = spring({ frame: f - Math.round(chipAt * FPS), fps: FPS, config: { damping: 200 }, durationInFrames: 12 });
  const pk = spring({ frame: f - Math.round(cpAt * FPS), fps: FPS, config: { damping: 200 }, durationInFrames: 14 });
  const stampS = pop(f, 4);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 52 }}>
      <Header title={c.title} badge={c.badge} f={f} stamp={!!c.stamp} />
      <div style={{ flex: 1, position: 'relative' }}>
        <TermView key={cur.rec} s={cur} el={el} fs={c.fs ?? 26} maxLines={c.maxLines ?? 15} />
        {t >= chipAt && t < cpAt && (
          <div style={{ position: 'absolute', right: 24, bottom: 24, maxWidth: 1000, padding: '18px 28px', background: '#fff', borderLeft: `10px solid ${OR}`, boxShadow: '0 12px 34px rgba(0,0,0,.28)', opacity: ck, transform: `translateY(${(1 - ck) * 30}px)` }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: INK }}>{chip.text}</div>
            <div style={{ fontSize: 23, fontWeight: 600, color: MUTED, marginTop: 6 }}>{chip.sub}</div>
          </div>
        )}
        {t >= cpAt && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 372, background: CREAM, border: `3px solid ${INK}`, padding: '18px 26px', display: 'flex', flexDirection: 'column', gap: 0, opacity: pk, transform: `translateY(${(1 - pk) * 120}px)`, boxShadow: '0 -16px 50px rgba(0,0,0,.30)' }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: INK, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, height: 62 }}><span style={{ width: 14, height: 14, background: OR }} />{cp.label}
              {t >= (st[2] ?? cpAt + 1) - 0.1 && csvChips.length > 0 && <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>{csvChips.map((x, i) => <div key={i} style={{ ...fadeUp(f, Math.round((st[2] ?? cpAt + 1) * FPS) + i * 5), padding: '6px 26px', background: OR, color: '#fff', fontSize: 40, fontWeight: 900 }}>{x}</div>)}</div>}
            </div>
            <div style={{ border: `2px solid ${INK}`, background: '#fff' }}>
              <Head h={48} fs={24} />
              {table.slice(0, cp.rows).map((r, i) => <Row key={i} i={i} r={r} h={i === cp.hi ? 64 : 46} fs={i === cp.hi ? 30 : 23} hi={i === cp.hi && t >= cpAt + 0.4} />)}
            </div>
          </div>
        )}
        {c.stamp && (
          <div style={{ position: 'absolute', right: 300, top: 70, transform: `rotate(-8deg) scale(${0.6 + 0.4 * stampS})`, opacity: Math.min(1, stampS * 1.5), padding: '14px 40px', border: `10px solid ${OR}`, color: OR, background: 'rgba(22,22,22,.85)', fontSize: 110, fontWeight: 900, letterSpacing: 6, borderRadius: 10 }}>{c.stamp}</div>
        )}
      </div>
      <Src text={c.source} />
    </div>
  );
};

// ---------- 代码卡 ----------
export const Code: React.FC<{ c: C }> = ({ c }) => {
  const f = useCurrentFrame(); const t = f / FPS;
  const src: string[] = c._code ?? [];
  let li = 0; c._starts.forEach((s, i) => { if (t >= s) li = i; });
  const hi: number[] = c.hi[li] ?? [];
  const sweep = li === 0 ? Math.floor(interpolate(t, [0.3, 1.6], [0, src.length], clamp)) : -1;
  const b = pop(f, 6);
  return (
    <div style={{ position: 'absolute', inset: 0, paddingBottom: 46 }}>
      <div style={{ position: 'relative', height: '100%', background: '#161616', borderRadius: 14, overflow: 'hidden', boxShadow: '0 16px 40px rgba(60,40,10,.18)' }}>
        <div style={{ height: 50, background: '#262626', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px' }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((x) => <div key={x} style={{ width: 16, height: 16, borderRadius: 8, background: x }} />)}
          <div style={{ marginLeft: 16, fontFamily: MONO, fontSize: 22, color: '#BDBDBD' }}>{c.file}</div>
        </div>
        <div style={{ padding: '12px 0', fontFamily: MONO, fontSize: 19.5, lineHeight: '29px', color: '#E6E6E6', whiteSpace: 'pre' }}>
          {src.map((l, i) => {
            const on = hi.includes(i + 1) || (sweep >= 0 && i < sweep);
            const strong = hi.includes(i + 1);
            return (
              <div key={i} style={{ display: 'flex', background: strong ? 'rgba(255,90,31,.28)' : on ? 'rgba(255,255,255,.06)' : undefined, borderLeft: `6px solid ${strong ? OR : 'transparent'}`, opacity: hi.length && !strong ? 0.45 : 1 }}>
                <span style={{ flex: '0 0 56px', textAlign: 'right', paddingRight: 16, color: on ? OR : '#666', fontWeight: on ? 700 : 400 }}>{i + 1}</span>
                <span>{l.startsWith('#') || l.includes('#  ') ? l : l}</span>
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', right: 40, top: 80, textAlign: 'right', transform: `scale(${b})`, transformOrigin: 'right top' }}>
          <div style={{ display: 'inline-block', padding: '8px 30px', background: OR, color: '#fff', fontSize: 120, fontWeight: 900, letterSpacing: -4, lineHeight: 1.05, boxShadow: '8px 8px 0 #000' }}>{src.length} 行</div>
          {li > 0 && <div key={li} style={{ ...fadeUp(f, Math.round(c._starts[li] * FPS)), marginTop: 22, padding: '12px 26px', background: '#fff', color: INK, fontSize: 44, fontWeight: 900, borderLeft: `10px solid ${OR}` }}>{c.notes[li]}</div>}
        </div>
      </div>
      <Src text={c.source} />
    </div>
  );
};

// ---------- 统计 + price_watch 实跑 ----------
export const Stats: React.FC<{ c: C }> = ({ c }) => {
  const f = useCurrentFrame(); const t = f / FPS; const st = c._starts;
  const s = c.session, at = st[s.line] + (s.dt ?? 0);
  const row = (label: string, val: string, d: number, hot?: boolean, sub?: string) => (
    <div style={{ ...fadeUp(f, d), padding: '20px 0', borderTop: `3px solid ${INK}` }}>
      <div style={{ fontSize: 30, fontWeight: 800, color: MUTED }}>{label}</div>
      <div style={{ fontSize: hot ? 150 : 92, fontWeight: 900, color: hot ? OR : INK, letterSpacing: -3, lineHeight: 1.05, whiteSpace: 'nowrap' }}>{val}{sub && <span style={{ fontSize: 34, letterSpacing: 0, color: INK, marginLeft: 16 }}>{sub}</span>}</div>
    </div>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 44, paddingBottom: 52 }}>
      <div style={{ flex: '0 0 640px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {row('价格区间', c.range, 4)}
        {row('均价', c.avg, 16)}
        {t >= st[2] - 0.05 && row('筛出', c.count, Math.round(st[2] * FPS), true, c.countLabel)}
      </div>
      <div style={{ flex: 1, position: 'relative', opacity: t >= at - 0.2 ? 1 : 0.0 }}>
        {t >= at - 0.2 && <TermView s={s} el={Math.max(0, t - at)} fs={22} maxLines={16} />}
      </div>
      <Src text={c.source} />
    </div>
  );
};

// ---------- 用途 / 提问 ----------
export const Uses: React.FC<{ c: C }> = ({ c }) => {
  const f = useCurrentFrame(); const t = f / FPS;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 40, paddingTop: 30 }}>
      <div style={{ ...fadeUp(f, 0), fontSize: 64, fontWeight: 900, color: INK }}>同样的做法,还能做</div>
      <div style={{ display: 'flex', gap: 40 }}>
        {(c.items as string[]).map((x, i) => (
          <div key={i} style={{ ...fadeUp(f, 8 + i * 9), flex: 1, background: '#fff', borderTop: `10px solid ${i === 0 ? OR : INK}`, padding: '56px 44px 80px', boxShadow: '0 12px 40px rgba(60,40,10,.08)' }}>
            <div style={{ fontSize: 90, fontWeight: 900, color: OR, lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{ fontSize: 88, fontWeight: 900, color: INK, marginTop: 26 }}>{x}</div>
          </div>
        ))}
      </div>
      {t >= c._starts[1] - 0.1 && (
        <div style={{ ...fadeUp(f, Math.round(c._starts[1] * FPS)), alignSelf: 'flex-start', padding: '20px 40px', background: INK, color: '#fff', fontSize: 52, fontWeight: 900, display: 'flex', gap: 18, alignItems: 'center' }}>
          <span style={{ color: OR }}>!</span>{c.note}
        </div>
      )}
    </div>
  );
};

export const Question: React.FC<{ c: C }> = ({ c }) => {
  const f = useCurrentFrame();
  const b = pop(f, 10);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40, paddingBottom: 60 }}>
      <div style={{ ...fadeUp(f, 0), fontSize: 30, fontWeight: 800, color: OR, letterSpacing: 3, display: 'flex', alignItems: 'center', gap: 14 }}><span style={{ width: 14, height: 14, background: OR }} />留言区</div>
      <div style={{ ...fadeUp(f, 3), fontSize: 120, fontWeight: 900, color: INK, lineHeight: 1.12, whiteSpace: 'pre-line', letterSpacing: -2 }}>{c.q}</div>
      <div style={{ alignSelf: 'flex-start', transform: `scale(${b}) rotate(-3deg)`, transformOrigin: 'left center', padding: '14px 40px', background: OR, color: '#fff', fontSize: 64, fontWeight: 900, boxShadow: '8px 8px 0 #141414' }}>{c.sub} ↓</div>
    </div>
  );
};

export const HKINDS: Record<string, React.FC<{ c: C }>> = { csvhook: CsvHook, rterm: RTerm, code: Code, stats: Stats, uses: Uses, question: Question };
