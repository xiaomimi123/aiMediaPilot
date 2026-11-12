// 产品录屏3D 通用版: 所有文字/素材/时间/出处来自 props.project(= project.config.json)
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, Easing } from 'remotion';
export const FPS = 30;
const SANS = '"Noto Sans CJK SC", "PingFang SC", "Inter", sans-serif';
const Y = '#FFE14D', INK = '#111';
const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.33, 0, 0.2, 1);
type Cap = { startSec: number; endSec: number; text: string; card: number; line: number };
type Span = { from: number; to: number };
type Props = { project: any; timeline: { durationSec: number; cards: Span[]; captions: Cap[] }; rec: any };
const Ctx = React.createContext<Props>(null as any);
const useT = () => useCurrentFrame() / FPS;
const lerpK = (t: number, ks: [number, number][]) => interpolate(t, ks.map((k) => k[0]), ks.map((k) => k[1]), { ...cl, easing: ease });

// ---------- 背景 ----------
const Bg: React.FC = () => {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(1200px 700px at 50% 40%, #2B3350 0%, #151A2C 55%, #0B0E18 100%)' }}>
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)', backgroundSize: '80px 80px', transform: `perspective(900px) rotateX(62deg) translateY(${(t * 40) % 80}px) scale(2.2)`, transformOrigin: '50% 100%', opacity: 0.55 }} />
    </AbsoluteFill>
  );
};

// ---------- 字幕: 亮黄粗字 + 粗黑描边, 整句出现 ----------
const Captions: React.FC = () => {
  const { timeline } = React.useContext(Ctx);
  const t = useT();
  const c = timeline.captions.find((x) => t >= x.startSec && t < x.endSec);
  if (!c) return null;
  const len = Array.from(c.text).reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? 1 : 0.55), 0);
  const size = Math.min(68, Math.floor(1500 / Math.max(1, len)));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, color: Y, WebkitTextStroke: `${Math.round(size / 6)}px ${INK}`, paintOrder: 'stroke fill', letterSpacing: 1, textShadow: '0 6px 16px rgba(0,0,0,.45)', whiteSpace: 'nowrap' }}>{c.text}</div>
    </div>
  );
};

// ---------- 花字/贴纸 ----------
type St = { at: number; dur?: number; text: string; src?: string; x: number; y: number; rot?: number; kind?: 'burst' | 'tag' | 'yellow' | 'green' | 'white'; size?: number };
const Sticker: React.FC<{ s: St; t: number }> = ({ s, t }) => {
  const f = Math.round((t - s.at) * FPS);
  if (t < s.at || t > s.at + (s.dur ?? 2.6)) return null;
  const k = spring({ frame: f, fps: FPS, config: { damping: 11, stiffness: 190 }, durationInFrames: 16 });
  const out = interpolate(t, [s.at + (s.dur ?? 2.6) - 0.2, s.at + (s.dur ?? 2.6)], [1, 0], cl);
  const kind = s.kind ?? 'yellow';
  const bg = kind === 'green' ? '#2BD46B' : kind === 'white' ? '#fff' : kind === 'tag' ? '#111' : Y;
  const fg = kind === 'tag' ? Y : INK;
  const size = s.size ?? 54;
  const estW = Array.from(s.text).reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? size : size * 0.58), 0);
  return (
    <div style={{ position: 'absolute', left: s.x, top: s.y, transform: `translate(-50%,-50%) rotate(${s.rot ?? -5}deg) scale(${k * out})`, zIndex: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', width: 'max-content' }}>
      {kind === 'green' && (
        <svg width={estW + size * 2.2} height={size * 3.2} viewBox="0 0 300 110" preserveAspectRatio="none" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-58%)', zIndex: -1 }}>
          <polygon points="10,55 40,30 30,5 75,20 110,0 140,18 185,2 205,25 260,10 250,40 295,55 255,70 270,100 215,88 185,108 150,90 110,108 85,86 35,100 45,74" fill="#2BD46B" stroke="#111" strokeWidth="5" strokeLinejoin="round" />
        </svg>
      )}
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, color: fg, background: bg, padding: '10px 28px', border: `5px solid ${INK}`, borderRadius: 14, boxShadow: '8px 8px 0 #111', whiteSpace: 'nowrap', lineHeight: 1.15 }}>{s.text}</div>
      {s.src && <div style={{ marginTop: kind === 'green' ? 34 : 14, fontFamily: SANS, fontSize: 22, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.72)', padding: '4px 12px', borderRadius: 6, whiteSpace: 'nowrap' }}>{s.src}</div>}
    </div>
  );
};
const Stickers: React.FC<{ list: St[] }> = ({ list }) => { const t = useT(); return <>{list.map((s, i) => <Sticker key={i} s={s} t={t} />)}</>; };

// ---------- 进出场: 推拉 + 模糊拖影 ----------
const useMove = (dur: number) => {
  const t = useT();
  const a = interpolate(t, [0, 0.45], [0, 1], { ...cl, easing: ease });
  const b = interpolate(t, [dur - 0.3, dur], [0, 1], { ...cl, easing: Easing.in(Easing.quad) });
  return { t, z: (1 - a) * -700 + b * 520, blur: (1 - a) * 16 + b * 18, op: Math.min(1, a * 2.5) * (1 - b * 0.6) };
};

// ---------- 录屏面板(3D 空间里) ----------
const W = 1500, H = 844;
type Seg = { from: number; to: number; focus?: [number, number, number, number][] }; // focus: [录屏秒, x, y, zoom] (视频像素)
const RecPanel: React.FC<{ src: string; segs: Seg[]; dur: number; rotY?: [number, number]; tag?: string; masks?: any[] }> = ({ src, segs, dur, rotY = [-9, 5], tag, masks }) => {
  const { t, z, blur, op } = useMove(dur);
  let acc = 0, seg = segs[0], segStart = 0;
  for (const s of segs) { if (t >= acc) { seg = s; segStart = acc; } acc += s.to - s.from; }
  const rt = seg.from + (t - segStart);
  const fk = seg.focus ?? [[seg.from, 960, 540, 1]];
  const fx = lerpK(rt, fk.map((k) => [k[0], k[1]])), fy = lerpK(rt, fk.map((k) => [k[0], k[2]])), zm = lerpK(rt, fk.map((k) => [k[0], k[3]]));
  const s = (W / 1920) * zm;
  const left = Math.min(0, Math.max(W - 1920 * s, W / 2 - fx * s)), top = Math.min(0, Math.max(H - 1080 * s, H / 2 - fy * s));
  // 段与段之间: 快速推近 + 模糊衔接(不硬切)
  let segBlur = 0, segPush = 0; acc = 0;
  for (let i = 0; i < segs.length - 1; i++) { acc += segs[i].to - segs[i].from; const d = Math.abs(t - acc); if (d < 0.22) { const k = 1 - d / 0.22; segBlur = Math.max(segBlur, 14 * k); segPush = Math.max(segPush, 160 * k); } }
  const ry = interpolate(t, [0, dur], rotY, cl);
  const startFrame = Math.round(seg.from * FPS);
  return (
    <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: '50% 42%' }}>
      <div style={{ position: 'absolute', left: (1920 - W) / 2, top: 50, width: W, height: H, transform: `translateZ(${z + segPush}px) rotateY(${ry}deg) rotateX(4deg)`, filter: `blur(${blur + segBlur}px)`, opacity: op, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.55), 0 0 0 3px rgba(255,255,255,.12)' }}>
        <div style={{ position: 'absolute', left, top, width: 1920 * s, height: 1080 * s }}>
          <Sequence key={startFrame + '_' + segStart} from={Math.round(segStart * FPS)} layout="none">
            <OffthreadVideo src={staticFile(src)} startFrom={startFrame} muted style={{ width: '100%', height: '100%' }} />
          </Sequence>
          {(masks ?? []).map((m, i) => <div key={i} style={{ position: 'absolute', left: m[0] * s, top: m[1] * s, width: m[2] * s, height: m[3] * s, background: m[4] ?? '#fff' }} />)}
        </div>
        {tag && <div style={{ position: 'absolute', left: 22, top: 20, padding: '6px 14px', borderRadius: 8, background: 'rgba(17,17,17,.82)', color: '#fff', fontFamily: SANS, fontSize: 22, fontWeight: 700 }}>{tag}</div>}
      </div>
    </AbsoluteFill>
  );
};

// ---------- 镜头 2: GitHub 仓库页 + 黄箭头 ----------
const Arrow: React.FC<{ x: number; y: number; at: number; label: string; dir?: 'down' | 'left' }> = ({ x, y, at, label }) => {
  const t = useT();
  if (t < at) return null;
  const k = spring({ frame: Math.round((t - at) * FPS), fps: FPS, config: { damping: 10, stiffness: 170 }, durationInFrames: 16 });
  const bob = Math.sin((t - at) * 7) * 8;
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%,-100%) translateY(${bob}px) scale(${k})`, transformOrigin: '50% 100%', zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 40, color: INK, background: Y, border: `5px solid ${INK}`, borderRadius: 12, padding: '4px 18px', marginBottom: 6, whiteSpace: 'nowrap', boxShadow: '6px 6px 0 #111' }}>{label}</div>
      <svg width="110" height="130" viewBox="0 0 110 130"><path d="M35 5 H75 V70 H102 L55 125 L8 70 H35 Z" fill={Y} stroke={INK} strokeWidth="7" strokeLinejoin="round" /></svg>
    </div>
  );
};

// ---------- 通用: 时间表达式 ----------
// at: 秒 | ["line", 行号, 加秒](相对本镜第 n 行字幕开始) ; dur: 秒 | ["toEnd", 留白秒](持续到本镜结束前)
type TSpec = number | [string, number, number?];
const Badge: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: 'absolute', right: 28, top: 22, zIndex: 60, padding: '8px 18px', borderRadius: 10, background: 'rgba(17,17,17,.82)', border: '2px solid rgba(255,255,255,.25)', color: '#fff', fontFamily: SANS, fontSize: 26, fontWeight: 800 }}>{text}</div>
);
const Label: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => (
  <div style={{ position: 'absolute', padding: '6px 14px', borderRadius: 8, background: 'rgba(17,17,17,.82)', color: '#fff', fontFamily: SANS, fontSize: 22, fontWeight: 700, ...style }}>{text}</div>
);
// 问句大字: [[{t, hl?}], ...] 每个数组一行
const Rich: React.FC<{ lines: { t: string; hl?: boolean }[][] }> = ({ lines }) => (
  <>{lines.map((ln, i) => <React.Fragment key={i}>{i > 0 && <br />}{ln.map((x, j) => x.hl ? <span key={j} style={{ color: Y }}>{x.t}</span> : <React.Fragment key={j}>{x.t}</React.Fragment>)}</React.Fragment>)}</>
);

// ---------- hook: 第 0 帧 = 痛点问句大字 + 结果画面; 3D 扇出只在前 fanSec 秒 ----------
const Hook: React.FC<{ dur: number; p: any }> = ({ dur, p }) => {
  const t = useT();
  const fan = interpolate(t, [0, p.fanSec ?? 1.0], [1, 0], { ...cl, easing: ease });
  const exit = interpolate(t, [dur - 0.3, dur], [0, 1], cl);
  const PW = 1240, PH = 698;
  const pages: { img: string; k: number }[] = p.pages; // k=0 为主图(结果), -1/1 为两侧
  return (
    <AbsoluteFill style={{ perspective: 2000, perspectiveOrigin: '50% 40%' }}>
      {pages.map((pg, i) => {
        const main = pg.k === 0;
        return (
          <div key={i} style={{ position: 'absolute', left: (1920 - PW) / 2 + 180, top: 250, width: PW, height: PH, transformOrigin: '50% 130%',
            transform: `translateX(${pg.k * 420 * fan}px) translateZ(${main ? 40 + exit * 500 : -160}px) rotateZ(${pg.k * 24 * fan}deg) rotateY(${-pg.k * 18 * fan}deg)`,
            opacity: main ? 1 : fan, borderRadius: 16, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.55)', border: '3px solid rgba(255,255,255,.18)', filter: `blur(${exit * 16}px)` }}>
            <Img src={staticFile(pg.img)} style={{ width: '100%', height: '100%' }} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 70, top: 70, zIndex: 30, fontFamily: SANS, fontWeight: 900, fontSize: 92, lineHeight: 1.18, color: '#fff', WebkitTextStroke: '14px #111', paintOrder: 'stroke fill', opacity: 1 - exit }}>
        <Rich lines={p.question} />
      </div>
      {p.label && <Label text={p.label} style={{ left: 1240, top: 205, zIndex: 30, opacity: 1 - exit }} />}
    </AbsoluteFill>
  );
};

// ---------- github: 仓库页截图 + 两个箭头(项目名 → Star) ----------
const GitHubShot: React.FC<{ dur: number; l1: number; p: any }> = ({ dur, l1, p }) => {
  const { t, z, blur, op } = useMove(dur);
  const [fx0, fx1, fy0] = p.focus ?? [760, 1340, 400];
  const fx = lerpK(t, [[0, fx0], [l1 - 0.3, fx0], [l1 + 0.5, fx1]]), fy = lerpK(t, [[0, fy0], [dur, fy0]]);
  const zm = lerpK(t, [[0, 1.0], [1.2, 1.3], [dur, 1.4]]);
  const PW = W, PH = H; const s = (PW / 1920) * zm;
  const left = Math.min(0, Math.max(PW - 1920 * s, PW / 2 - fx * s)), top = Math.min(0, Math.max(PH - 1080 * s, PH / 2 - fy * s));
  const ox = (1920 - PW) / 2, oy = 34;
  const pt = (x: number, y: number) => ({ x: ox + left + x * s, y: oy + top + y * s });
  const a1 = pt(p.nameXY[0], p.nameXY[1]), a2 = pt(p.starXY[0], p.starXY[1]);
  return (
    <AbsoluteFill style={{ perspective: 2200 }}>
      <div style={{ position: 'absolute', left: ox, top: oy, width: PW, height: PH, transform: `translateZ(${z}px) rotateY(${interpolate(t, [0, dur], [6, -4])}deg)`, filter: `blur(${blur}px)`, opacity: op, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.55)' }}>
        <Img src={staticFile(p.img)} style={{ position: 'absolute', left, top, width: 1920 * s, height: 1080 * s }} />
        <Label text={p.label} style={{ left: 16, bottom: 14 }} />
      </div>
      {t < l1 + 0.2 && <Arrow x={a1.x} y={a1.y - 6} at={0.6} label={p.nameArrow ?? '项目名'} />}
      <Arrow x={a2.x} y={a2.y - 6} at={l1 + 0.3} label={p.starArrow} />
    </AbsoluteFill>
  );
};

// ---------- readme: README 原句高亮 + 本机窗口(地址栏为绘制, URL 来自配置) ----------
const ReadmeShot: React.FC<{ dur: number; p: any }> = ({ dur, p }) => {
  const { t, z, blur, op } = useMove(dur);
  const hl = interpolate(t, [0.4, 0.9], [0, 1], cl);
  const k = 0.62; const box = p.box;
  return (
    <AbsoluteFill style={{ perspective: 2200 }}>
      <div style={{ position: 'absolute', left: 90, top: 70, width: 1920 * k, height: 1080 * k, transform: `translateZ(${z}px) rotateY(8deg)`, filter: `blur(${blur}px)`, opacity: op, borderRadius: 16, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.55)' }}>
        <Img src={staticFile(p.img)} style={{ width: '100%', height: '100%' }} />
        {box && <div style={{ position: 'absolute', left: (box.x - 8) * k, top: (box.y - 6) * k, width: (box.width + 16) * k * hl, height: (box.height + 12) * k, border: `5px solid ${Y}`, background: 'rgba(255,225,77,.18)', borderRadius: 8 }} />}
        <Label text={p.label} style={{ left: 12, bottom: 10, padding: '5px 12px', fontSize: 20 }} />
      </div>
      {p.localImg && (
        <div style={{ position: 'absolute', left: 900, top: 380, width: 920, transform: `translateZ(${z + 80}px) rotateY(-10deg)`, filter: `blur(${blur}px)`, opacity: op * interpolate(t, [0.5, 1.0], [0, 1], cl), borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 90px rgba(0,0,0,.6)', background: '#fff' }}>
          <div style={{ height: 54, background: '#E9EBEF', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
            <div style={{ marginLeft: 14, flex: 1, height: 34, borderRadius: 17, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 18px', fontFamily: SANS, fontSize: 24, color: '#333' }}>🔒 {p.url}</div>
          </div>
          <Img src={staticFile(p.localImg)} style={{ width: 920, height: 517 }} />
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- end: 虚化背景 + 二选一 + 评论区按钮 ----------
const EndShot: React.FC<{ dur: number; l3: number; p: any }> = ({ dur, l3, p }) => {
  const t = useT();
  const k = spring({ frame: Math.round((t - 0.2) * FPS), fps: FPS, config: { damping: 12, stiffness: 160 }, durationInFrames: 18 });
  const btn = spring({ frame: Math.round((t - l3) * FPS), fps: FPS, config: { damping: 9, stiffness: 200 }, durationInFrames: 18 });
  const bgIn = interpolate(t, [0, 0.6], [0, 1], cl);
  const card = (txt: string, c: string) => <div style={{ padding: '26px 54px', borderRadius: 22, background: c, border: `6px solid ${INK}`, boxShadow: '10px 10px 0 #111', fontFamily: SANS, fontWeight: 900, fontSize: 80, color: INK }}>{txt}</div>;
  return (
    <AbsoluteFill>
      <Img src={staticFile(p.bg)} style={{ position: 'absolute', inset: -60, width: 2040, height: 1200, filter: `blur(${4 + 18 * bgIn}px) brightness(${1 - 0.45 * bgIn})` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', transform: `scale(${k})`, fontFamily: SANS, fontWeight: 900, fontSize: 92, color: '#fff', WebkitTextStroke: '14px #111', paintOrder: 'stroke fill' }}>{p.title}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 370, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 60, transform: `scale(${k})` }}>
        {card(p.a, Y)}<div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 80, color: '#fff', WebkitTextStroke: '10px #111', paintOrder: 'stroke fill' }}>{p.mid ?? '还是'}</div>{card(p.b, '#fff')}
      </div>
      {t >= l3 && (
        <div style={{ position: 'absolute', left: '50%', top: 640, transform: `translateX(-50%) scale(${btn})`, display: 'flex', alignItems: 'center', gap: 18, padding: '18px 54px', borderRadius: 999, background: '#fff', border: `6px solid ${INK}`, boxShadow: '10px 10px 0 #111', fontFamily: SANS, fontWeight: 900, fontSize: 56, color: INK }}>
          <svg width="64" height="64" viewBox="0 0 24 24"><path d="M4 4h16v11H9l-5 4z" fill={Y} stroke="#111" strokeWidth="2" strokeLinejoin="round" /><circle cx="9" cy="9.5" r="1.2" fill="#111" /><circle cx="12" cy="9.5" r="1.2" fill="#111" /><circle cx="15" cy="9.5" r="1.2" fill="#111" /></svg>
          {p.cta ?? '评论区说'}
        </div>
      )}
    </AbsoluteFill>
  );
};

// 文案里的 {key} 用 project.sources 替换(出处/采集时间只写在配置里, build 不会覆盖)
const fill = (s: any, src: Record<string, string>): any =>
  typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => src[k] ?? `{${k}}`) : Array.isArray(s) ? s.map((x) => fill(x, src)) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, fill(v, src)])) : s;

export const Film: React.FC<Props> = (props) => {
  const { timeline } = props;
  if (!timeline.cards.length) return null;
  const C = timeline.cards;
  const P = fill(props.project, props.project.sources ?? {});
  const ls = (ci: number, li: number) => { const c = timeline.captions.find((x) => x.card === ci && x.line === li); return c ? c.startSec - C[ci].from : 0; };
  const d = (i: number) => C[i].to - C[i].from;
  const T = (ci: number, v: TSpec): number => (typeof v === 'number' ? v : v[0] === 'line' ? ls(ci, v[1]) + (v[2] ?? 0) : v[0] === 'end' ? d(ci) - v[1] : 0);
  const stickers = (ci: number, list: any[] = []): St[] => list.map((s) => {
    const at = T(ci, s.at);
    const dur = Array.isArray(s.dur) && s.dur[0] === 'toEnd' ? d(ci) - at - s.dur[1] : s.dur;
    return { ...s, at, dur };
  });
  const segs = (ci: number, list: any[]): Seg[] => { let used = 0; return list.map((g) => { const to = g.to === 'rest' ? g.from + d(ci) - used : g.to; used += to - g.from; return { from: g.from, to, focus: g.focus }; }); };
  const seq = (i: number, el: React.ReactNode, st: St[] = []) => (
    <Sequence key={i} from={Math.round(C[i].from * FPS)} durationInFrames={Math.max(1, Math.round(C[i].to * FPS) - Math.round(C[i].from * FPS))} layout="none">
      {el}<Stickers list={st} />
    </Sequence>
  );
  const shot = (sh: any, i: number) => {
    const p = sh.view ?? {};
    const st = stickers(i, p.stickers);
    switch (sh.kind) {
      case 'hook': return seq(i, <Hook dur={d(i)} p={p} />, st);
      case 'github': return seq(i, <GitHubShot dur={d(i)} l1={ls(i, 1)} p={p} />, st);
      case 'rec': return seq(i, <RecPanel dur={d(i)} src={p.src} tag={p.tag} masks={p.masks ?? P.recMasks} segs={segs(i, p.segs)} rotY={p.rotY} />, st);
      case 'readme': return seq(i, <ReadmeShot dur={d(i)} p={p} />, st);
      case 'end': return seq(i, <EndShot dur={d(i)} l3={ls(i, p.ctaLine ?? 2)} p={p} />, st);
      default: return null;
    }
  };
  return (
    <Ctx.Provider value={props}>
      <AbsoluteFill style={{ fontFamily: SANS, background: '#0B0E18' }}>
        <Bg />
        <Audio src={staticFile('narr.mp3')} />
        {P.shots.map(shot)}
        {P.badge && <Badge text={P.badge} />}
        <Captions />
      </AbsoluteFill>
    </Ctx.Provider>
  );
};
