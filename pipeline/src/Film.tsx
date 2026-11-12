import React from 'react';
import { Browser, Screen } from './Browser';
import { HKINDS, HCtx } from './Hands';
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { MONO, NUM, SANS } from './fonts';

export const FPS = 30;

type Theme = { bg: string; bg2: string; card: string; ink: string; muted: string; accent: string; accent2: string; good: string; bad: string };
type Card = { kind: string; lines: string[]; [k: string]: any };
export type Project = {
  slug: string; repo: string; name: string; tagline: string; asOf: string;
  stats: { stars: number; forks: number; updated: string; updatedLabel?: string; license: string; language?: string };
  theme: Theme; chrome: { topLeft: string; watermark: string }; cards: Card[];
};
type Span = { from: number; to: number };
type Cap = { startSec: number; endSec: number; text: string; card?: number; line?: number };
export type FilmProps = { project: Project; screens?: Record<string, Screen>; recs?: any; csv?: any; timeline: { durationSec: number; cards: Span[]; captions: Cap[] } };

const Ctx = React.createContext<Project>(null as unknown as Project);
const useP = () => React.useContext(Ctx);
const fmt = (n: number) => n.toLocaleString('en-US');
const wan = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : fmt(n));

/** 入场: 第 delay 帧开始, 上移+淡入 */
const useIn = (delay = 0) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 200, mass: 0.7 }, durationInFrames: 16 });
  return { opacity: s, transform: `translateY(${(1 - s) * 14}px)` } as React.CSSProperties;
};

const Source: React.FC<{ text?: string }> = ({ text }) => {
  const p = useP();
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 8, fontSize: 22, color: p.theme.muted, fontFamily: SANS, fontWeight: 600, letterSpacing: 0.2, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 28, height: 3, background: p.theme.accent }} />
      {text ?? `数据来源: github.com/${p.repo} · 截至 ${p.asOf}`}
    </div>
  );
};

const Kicker: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const p = useP();
  return <div style={{ ...useIn(delay), fontSize: 26, fontWeight: 800, color: p.theme.accent, letterSpacing: 2.4, display: 'flex', alignItems: 'center', gap: 14 }}><span style={{ width: 12, height: 12, background: p.theme.accent }} />{children}</div>;
};

const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 72 }) => {
  const p = useP();
  return <div style={{ ...useIn(0), fontSize: size, fontWeight: 900, color: p.theme.ink, lineHeight: 1.16, whiteSpace: 'pre-line', letterSpacing: -0.5 }}>{children}</div>;
};

/** solid: 主色实心白字; 否则墨色细描边 */
const Chip: React.FC<{ children: React.ReactNode; solid?: boolean; delay?: number; size?: number }> = ({ children, solid, delay = 0, size = 30 }) => {
  const p = useP();
  return (
    <div style={{ ...useIn(delay), display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 26px', borderRadius: 999, border: `2px solid ${solid ? p.theme.accent : p.theme.ink}`, color: solid ? '#fff' : p.theme.ink, background: solid ? p.theme.accent : 'transparent', fontSize: size, fontWeight: 700, letterSpacing: 0.2 }}>
      {children}
    </div>
  );
};

const Big: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({ children, size = 220, color }) => {
  const p = useP();
  return <div style={{ fontFamily: NUM, fontSize: size, fontWeight: 900, lineHeight: 0.92, color: color ?? p.theme.ink, letterSpacing: -4, fontVariantNumeric: 'tabular-nums' }}>{children}</div>;
};

// ---------- 信息卡(杂志版式: 奶白底、粗黑大字、一个主色、细线分隔) ----------
const Hook: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  return (
    <div style={{ display: 'flex', height: '100%', padding: '40px 20px 60px', gap: 90, alignItems: 'center' }}>
      <div style={{ flex: 1.35, display: 'flex', flexDirection: 'column', gap: 30 }}>
        {c.kicker && <Kicker>{c.kicker}</Kicker>}
        <Title size={c.titleSize ?? 92}>{c.title}</Title>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {(c.points as string[]).map((t, i) => (
          <div key={i} style={{ ...useIn(10 + i * 8), display: 'flex', alignItems: 'baseline', gap: 28, padding: '34px 0', borderTop: `2px solid ${p.theme.ink}`, borderBottom: i === c.points.length - 1 ? `2px solid ${p.theme.ink}` : undefined }}>
            <span style={{ fontFamily: NUM, fontSize: 76, fontWeight: 900, color: p.theme.accent, lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ fontSize: 48, fontWeight: 800, color: p.theme.ink }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Overview: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const f = useCurrentFrame();
  const nodes = c.flow as string[];
  return (
    <div style={{ height: '100%', padding: '40px 20px 60px', display: 'flex', flexDirection: 'column' }}>
      <Kicker>github.com/{p.repo}</Kicker>
      <div style={{ ...useIn(3), fontSize: 112, fontWeight: 900, color: p.theme.ink, marginTop: 14, letterSpacing: -2, lineHeight: 1.02 }}>{p.name}</div>
      <div style={{ ...useIn(6), fontSize: 40, color: p.theme.muted, marginTop: 12, lineHeight: 1.35 }}>{c.desc ?? p.tagline}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        {nodes.map((n, i) => {
          const o = interpolate(f, [12 + i * 9, 22 + i * 9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <React.Fragment key={i}>
              {i > 0 && <div style={{ opacity: o, flex: '0 0 80px', textAlign: 'center', fontSize: 56, fontWeight: 900, color: p.theme.accent }}>→</div>}
              <div style={{ opacity: o, flex: 1, padding: '36px 20px', borderTop: `6px solid ${p.theme.ink}`, background: '#fff', textAlign: 'center', fontSize: 38, fontWeight: 800, color: p.theme.ink, lineHeight: 1.25, boxShadow: '0 10px 28px rgba(40,28,12,0.06)' }}>{n}</div>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 20, paddingBottom: 40 }}>
        <Chip solid delay={20}>★ {fmt(p.stats.stars)}</Chip>
        <Chip delay={24}>Fork {fmt(p.stats.forks)}</Chip>
      </div>
      <Source />
    </div>
  );
};

const Stars: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const f = useCurrentFrame();
  const k = interpolate(f, [4, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - Math.pow(1 - x, 3) });
  return (
    <div style={{ height: '100%', padding: '40px 20px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
      <Kicker>{c.label ?? 'GITHUB STAR'}</Kicker>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 30 }}>
        <Big size={300} color={p.theme.accent}>★</Big>
        <Big size={300}>{fmt(Math.round(p.stats.stars * k))}</Big>
      </div>
      <div style={{ ...useIn(30), fontSize: 46, color: p.theme.ink, fontWeight: 700 }}>{c.note ?? `约 ${wan(p.stats.stars)}`}</div>
      <div style={{ display: 'flex', gap: 20 }}>
        <Chip delay={36}>Fork {fmt(p.stats.forks)}</Chip>
        <Chip delay={40}>{p.stats.updatedLabel ?? '最近更新'} {p.stats.updated}</Chip>
      </div>
      <Source />
    </div>
  );
};

const Ecosystem: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const items = c.items as { name: string; sub?: string; logo?: string; main?: boolean }[];
  const main = items.filter((x) => x.main);
  const rest = items.filter((x) => !x.main);
  return (
    <div style={{ height: '100%', padding: '30px 20px 60px', display: 'flex', flexDirection: 'column', gap: 36 }}>
      {c.kicker && <Kicker>{c.kicker}</Kicker>}
      <Title size={c.titleSize ?? 80}>{c.title}</Title>
      <div style={{ flex: 1, display: 'flex', gap: 60, alignItems: 'stretch', paddingBottom: 50 }}>
        {main.map((it, i) => (
          <div key={i} style={{ ...useIn(8), flex: '0 0 640px', background: '#fff', borderTop: `8px solid ${p.theme.accent}`, padding: '44px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24, boxShadow: '0 12px 40px rgba(60,40,10,.08)' }}>
            {it.logo && <Img src={staticFile(it.logo)} style={{ width: 150, height: 150, objectFit: 'contain' }} />}
            <div style={{ fontSize: 68, fontWeight: 900, color: p.theme.ink, whiteSpace: 'nowrap' }}>{it.name}</div>
            {it.sub && <div style={{ fontSize: 40, fontWeight: 800, color: p.theme.accent }}>{it.sub}</div>}
          </div>
        ))}
        {rest.length > 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {c.restTitle && <div style={{ ...useIn(12), fontSize: 30, fontWeight: 700, color: p.theme.muted, marginBottom: 14 }}>{c.restTitle}</div>}
            {rest.map((it, i) => (
              <div key={i} style={{ ...useIn(14 + i * 5), display: 'flex', alignItems: 'center', gap: 24, padding: '34px 0', borderTop: `2px solid ${p.theme.ink}`, borderBottom: i === rest.length - 1 ? `2px solid ${p.theme.ink}` : undefined }}>
                {it.logo && <Img src={staticFile(it.logo)} style={{ width: 64, height: 64, objectFit: 'contain' }} />}
                <span style={{ fontSize: 54, fontWeight: 900, color: p.theme.ink, whiteSpace: 'nowrap' }}>{it.name}</span>
                {it.sub && <span style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 700, color: p.theme.muted, border: `2px solid ${p.theme.muted}`, borderRadius: 8, padding: '4px 14px' }}>{it.sub}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <Source text={c.source} />
    </div>
  );
};

const Highlights: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const f = useCurrentFrame();
  const rows = c.rows as { label: string; value: string; bar?: number; hi?: boolean; note?: string }[];
  return (
    <div style={{ height: '100%', padding: '30px 20px 60px', display: 'flex', flexDirection: 'column' }}>
      <Title>{c.title}</Title>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 50 }}>
        {rows.map((r, i) => {
          const w = interpolate(f, [10 + i * 6, 34 + i * 6], [0, r.bar ?? 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={i} style={{ ...useIn(6 + i * 6), display: 'flex', alignItems: 'center', gap: 30, padding: '26px 0', borderTop: `2px solid ${p.theme.ink}` }}>
              <div style={{ flex: '0 0 380px', fontSize: 44, fontWeight: 800, color: p.theme.ink }}>{r.label}</div>
              <div style={{ flex: 1, height: 22, background: `${p.theme.ink}14`, display: r.bar !== undefined ? 'block' : 'none' }}>
                <div style={{ width: `${w * 100}%`, height: '100%', background: r.hi ? p.theme.accent : p.theme.ink }} />
              </div>
              {r.note && <div style={{ flex: 1, fontSize: 36, color: p.theme.muted }}>{r.note}</div>}
              <div style={{ flex: '0 0 auto', textAlign: 'right', fontFamily: NUM, fontSize: 80, fontWeight: 900, color: r.hi ? p.theme.accent : p.theme.ink }}>{r.value}</div>
            </div>
          );
        })}
      </div>
      <Source text={c.source} />
    </div>
  );
};

const Terminal: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const f = useCurrentFrame();
  const cmd: string = c.cmd;
  const typed = Math.min(cmd.length, Math.max(0, Math.floor((f - 6) * 1.6)));
  const typeEnd = 6 + cmd.length / 1.6;
  const out = c.output as string[];
  const shown = Math.max(0, Math.floor((f - typeEnd - 4) / 2.5));
  const server = c.origin === 'server';
  return (
    <div style={{ height: '100%', padding: '20px 20px 60px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title size={56}>{c.title}</Title>
        <Chip solid={!server} delay={4} size={26}>{c.originLabel ?? (server ? '服务器实测输出' : 'README 截取')}</Chip>
      </div>
      <div style={{ flex: 1, borderRadius: 18, background: '#161616', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 18px 44px rgba(40,28,12,0.16)' }}>
        <div style={{ height: 56, background: '#242424', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px' }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((x) => <div key={x} style={{ width: 18, height: 18, borderRadius: 9, background: x }} />)}
          <div style={{ marginLeft: 20, fontFamily: MONO, fontSize: 22, color: '#A3A3A3' }}>{c.windowTitle ?? 'bash'}</div>
        </div>
        <div style={{ padding: '26px 36px', fontFamily: MONO, fontSize: c.fontSize ?? 30, lineHeight: 1.55, color: '#F4F1EC', whiteSpace: 'pre' }}>
          <div><span style={{ color: p.theme.accent }}>$ </span>{cmd.slice(0, typed)}{typed < cmd.length && <span style={{ background: '#F5F5F5' }}> </span>}</div>
          {out.slice(0, shown).map((l, i) => <div key={i}>{l || ' '}</div>)}
        </div>
      </div>
      {c.source && <Source text={c.source} />}
    </div>
  );
};

const Install: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  return (
    <div style={{ height: '100%', padding: '30px 20px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 46 }}>
      <Title size={80}>{c.title}</Title>
      <div style={{ ...useIn(8), padding: '52px 56px', textAlign: c.prompt === '' ? 'center' : 'left', background: '#161616', borderLeft: `12px solid ${p.theme.accent}`, borderRadius: '0 16px 16px 0', fontFamily: MONO, fontSize: c.cmdSize ?? 64, fontWeight: 700, color: '#fff', lineHeight: 1.35, boxShadow: '0 16px 40px rgba(40,28,12,0.12)' }}>
        {c.prompt !== '' && <span style={{ color: p.theme.accent }}>{c.prompt ?? '$'} </span>}{c.cmd}
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        {(c.next as string[] ?? []).map((t, i) => <Chip key={i} delay={18 + i * 6}>{t}</Chip>)}
      </div>
    </div>
  );
};

const Audience: React.FC<{ c: Card }> = ({ c }) => {
  const p = useP();
  const col = (title: string, items: string[], good: boolean, d: number) => (
    <div style={{ flex: 1, padding: '36px 44px', background: good ? '#fff' : 'transparent', borderTop: `8px solid ${good ? p.theme.ink : p.theme.accent}`, boxShadow: good ? '0 12px 40px rgba(60,40,10,.08)' : undefined }}>
      <div style={{ ...useIn(d), fontSize: 64, fontWeight: 900, color: good ? p.theme.ink : p.theme.accent, marginBottom: 18 }}>{title}</div>
      {items.map((t, i) => (
        <div key={i} style={{ ...useIn(d + 6 + i * 6), fontSize: 40, color: p.theme.ink, fontWeight: 700, padding: '18px 0', borderTop: `1.5px solid ${p.theme.ink}22`, display: 'flex', gap: 20, alignItems: 'center' }}>
          <span style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 22, background: good ? p.theme.ink : p.theme.accent, color: '#fff', fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{good ? '✓' : '✕'}</span>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ height: '100%', padding: '20px 20px 60px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ flex: 1, display: 'flex', gap: 50 }}>
        {col(c.goodTitle ?? '适合', c.good, true, 0)}
        {col(c.badTitle ?? '不适合', c.bad, false, 14)}
      </div>
      <div style={{ display: 'flex', gap: 20, paddingBottom: 30 }}>
        <Chip solid delay={30}>{p.stats.license} 协议</Chip>
        <Chip delay={34}>github.com/{p.repo}</Chip>
      </div>
      <Source />
    </div>
  );
};

const KINDS: Record<string, React.FC<{ c: Card }>> = { hook: Hook, overview: Overview, stars: Stars, ecosystem: Ecosystem, highlights: Highlights, terminal: Terminal, install: Install, audience: Audience };

// ---------- 画框 ----------
const Captions: React.FC<{ caps: Cap[] }> = ({ caps }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const c = caps.find((x) => t >= x.startSec && t < x.endSec);
  if (!c) return null;
  const len = Array.from(c.text).reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? 1 : 0.55), 0);
  const size = Math.min(42, Math.floor(1180 / Math.max(1, len)));
  return (
    <div style={{ position: 'absolute', left: 64, right: 210, bottom: 34, display: 'flex', justifyContent: 'center' }}>
      <div style={{ background: '#161412', color: '#fff', fontFamily: SANS, fontWeight: 700, fontSize: size, lineHeight: 1.35, letterSpacing: 0.3, padding: '13px 32px', borderRadius: 12, maxWidth: 1240, textAlign: 'center', boxShadow: '0 12px 32px rgba(20,16,10,0.22)' }}>
        {c.text}
      </div>
    </div>
  );
};

export const Film: React.FC<FilmProps> = ({ project: p, timeline, screens = {}, recs = {}, csv = {} }) => {
  const f = useCurrentFrame();
  if (!p) return null;
  const t = f / FPS;
  const n = p.cards.length;
  const idx = Math.max(0, timeline.cards.findIndex((s) => t >= s.from && t < s.to));
  const T = p.theme;
  return (
    <Ctx.Provider value={p}><HCtx.Provider value={{ recs, csv }}>
      <AbsoluteFill style={{ fontFamily: SANS, background: T.bg }}>
        <div style={{ position: 'absolute', left: 64, right: 64, top: 82, height: 1, background: T.ink }} />
        <Audio src={staticFile('narr.mp3')} />
        {/* 左上声明 / 右上水印 */}
        <div style={{ position: 'absolute', left: 64, top: 32, fontSize: 22, fontWeight: 700, color: T.ink, letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 11, height: 11, background: T.accent }} />{p.chrome.topLeft}</div>
        <div style={{ position: 'absolute', right: 64, top: 30, fontSize: 22, fontWeight: 800, color: T.ink, letterSpacing: 1.6 }}>{p.chrome.watermark}</div>
        {/* 卡片区 */}
        {p.cards.map((c, i) => {
          const s = timeline.cards[i];
          const from = Math.round(s.from * FPS);
          if (c.kind === 'browser') {
            const times = (c.beats as any[]).map((b) => {
              const cap = timeline.captions.find((x) => x.card === i && x.line === b.line);
              return (cap ? cap.startSec : s.from) - s.from + (b.dt ?? 0);
            });
            return (
              <Sequence key={i} from={from} durationInFrames={Math.max(1, Math.round(s.to * FPS) - from)} layout="none">
                <CardShell framed><Browser beats={c.beats} times={times} endSec={s.to - s.from} screens={screens} theme={p.theme} source={c.source} /></CardShell>
              </Sequence>
            );
          }
          const H = HKINDS[c.kind];
          if (H) {
            const starts = c.lines.map((_: string, li: number) => { const cap = timeline.captions.find((x) => x.card === i && x.line === li); return (cap ? cap.startSec : s.from) - s.from; });
            return (
              <Sequence key={i} from={from} durationInFrames={Math.max(1, Math.round(s.to * FPS) - from)} layout="none">
                <CardShell noFade={i === 0}><H c={{ ...c, _starts: starts, _dur: s.to - s.from }} /></CardShell>
              </Sequence>
            );
          }
          const K = KINDS[c.kind];
          return (
            <Sequence key={i} from={from} durationInFrames={Math.max(1, Math.round(s.to * FPS) - from)} layout="none">
              <CardShell><K c={c} /></CardShell>
            </Sequence>
          );
        })}
        {/* 右下页码 */}
        <div style={{ position: 'absolute', right: 64, bottom: 32, fontFamily: NUM, fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'baseline', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: T.accent, fontSize: 44, letterSpacing: -1, fontWeight: 900 }}>{String(idx + 1).padStart(2, '0')}</span><span style={{ fontSize: 26, color: T.muted, fontWeight: 700 }}>/ {String(n).padStart(2, '0')}</span>
        </div>
        <Captions caps={timeline.captions} />
      </AbsoluteFill>
    </HCtx.Provider></Ctx.Provider>
  );
};

const CardShell: React.FC<{ children: React.ReactNode; framed?: boolean; noFade?: boolean }> = ({ children, framed, noFade }) => {
  const p = useP();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = noFade ? 1 : spring({ frame: f, fps, config: { damping: 200, mass: 0.65 }, durationInFrames: 14 });
  return (
    <div style={{ position: 'absolute', left: 64, top: 108, width: 1792, height: 784, borderRadius: framed ? 18 : 0, background: framed ? '#fff' : 'transparent', border: framed ? `1.5px solid ${p.theme.ink}` : 'none', boxShadow: framed ? '0 18px 48px rgba(40,28,12,0.12)' : 'none', overflow: framed ? 'hidden' : 'visible', transform: `translateY(${(1 - s) * 18}px)` }}>
      {children}
    </div>
  );
};
