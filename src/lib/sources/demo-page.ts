import type { StructuredLLM } from '@/lib/script/write';
import { z } from 'zod';

/**
 * 自动构建演示介绍页: 很多开源项目没有官网, 快讯档出画面时按 README
 * 生成一个风格化的产品介绍页, 再由 demo-recorder 录成横版视频当素材。
 *
 * 风格按项目气质四选一(用户 2026-11-10 定的: 不同项目不同风格, 不做单一模板):
 * - terminal: 深色终端窗口 + 等宽字体, 适合 CLI/开发工具
 * - gradient: 深色 + 霓虹渐变 + 大标题, 适合 AI/agent 框架
 * - clean: 暖白大留白 + 衬线大标题, 适合文档库/设计工具
 * - bold: 高饱和底色 + 超大字, 适合有明显态度的项目
 */

export const DEMO_STYLES = ['terminal', 'gradient', 'clean', 'bold'] as const;
export type DemoStyle = (typeof DEMO_STYLES)[number];

const DemoPageSchema = z.object({
  style: z.enum(DEMO_STYLES),
  kicker: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  subtitle: z.string().min(1).max(120),
  points: z.array(z.object({ head: z.string().min(1).max(24), body: z.string().min(1).max(90) })).min(3).max(4),
  command: z.string().max(120),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type DemoPage = z.infer<typeof DemoPageSchema>;

const SYSTEM_PROMPT = `你是短视频画面设计师。给开源项目设计一页 1920×1080 的演示介绍页内容, 之后会录成视频当快讯画面。
- 只用【README 摘录】里的信息, 不编造功能或数字。
- style 按项目气质选: terminal(CLI/开发工具) / gradient(AI/agent 框架) / clean(文档/设计类) / bold(态度鲜明的项目)。
- kicker 一行小字(栏目感, 如「开源项目快讯」), title 是项目一句话定位, subtitle 补充说明。
- points 是 3~4 个卖点(每条: head 8~14 字标题 + body 一句大白话), 按普通人关心的程度排。
- command: README 里真实的安装/运行命令(没有就空字符串), 展示用。
- accent: 这个风格的强调色(hex), 要和内容气质搭。
只输出 JSON。`;

export async function designDemoPage(opts: { llm: StructuredLLM; repo: string; starCount: number | null; readme: string }): Promise<DemoPage> {
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      { type: 'text', text: `【仓库】${opts.repo}${opts.starCount !== null ? `（${opts.starCount.toLocaleString('en-US')} stars）` : ''}\n【README 摘录】\n${opts.readme.slice(0, 3000)}\n设计这页演示页。` },
    ],
    responseSchema: DemoPageSchema,
  });
  return result;
}

const FONT_STACK = {
  terminal: "'SF Mono', Menlo, monospace",
  gradient: "'Helvetica Neue', 'PingFang SC', sans-serif",
  clean: "'Georgia', 'Songti SC', serif",
  bold: "'Arial Black', 'PingFang SC', sans-serif",
} as const;

/** 各风格同一套布局骨架, 换皮: 背景层 + 字体 + 卖点排布由 style 决定 */
export function renderDemoHtml(p: DemoPage, repo: string, starCount: number | null): string {
  const font = FONT_STACK[p.style];
  const stars = starCount !== null ? `${starCount.toLocaleString('en-US')} stars` : repo;

  const bg = {
    terminal: `background:#0d1117;`,
    gradient: `background:radial-gradient(1200px 800px at 20% 10%, #1a1033 0%, #0a0a14 60%), #0a0a14;`,
    clean: `background:#faf7f2;`,
    bold: `background:${p.accent};`,
  }[p.style];
  const fg = { terminal: '#e6edf3', gradient: '#f2f0ff', clean: '#1a1a1a', bold: '#ffffff' }[p.style];
  const subFg = { terminal: '#8b949e', gradient: '#a89ec4', clean: '#6b6459', bold: 'rgba(255,255,255,.85)' }[p.style];
  const cardBg = { terminal: '#161b22', gradient: 'rgba(255,255,255,.06)', clean: '#ffffff', bold: 'rgba(0,0,0,.18)' }[p.style];
  const cardBorder = { terminal: '#30363d', gradient: 'rgba(255,255,255,.12)', clean: '#e8e2d8', bold: 'rgba(255,255,255,.25)' }[p.style];
  const titleSize = { terminal: 64, gradient: 76, clean: 72, bold: 96 }[p.style];
  const titleWeight = { terminal: 700, gradient: 800, clean: 700, bold: 900 }[p.style];
  const titleTransform = { terminal: 'none', gradient: 'none', clean: 'none', bold: 'uppercase' }[p.style];
  const kickerStyle =
    p.style === 'terminal'
      ? `display:inline-block;border:1px solid ${p.accent};color:${p.accent};padding:6px 16px;border-radius:6px;`
      : `color:${p.style === 'clean' ? '#6b6459' : subFg};letter-spacing:.3em;`;

  const cards = p.points
    .map(
      (pt, i) => `<div class="card"><div class="card-num">${String(i + 1).padStart(2, '0')}</div><div class="card-head">${esc(pt.head)}</div><div class="card-body">${esc(pt.body)}</div></div>`,
    )
    .join('');

  const cmdBlock = p.command
    ? `<div class="cmd"><span class="cmd-prompt">$</span> ${esc(p.command)}</div>`
    : `<div class="cmd" style="visibility:hidden"><span class="cmd-prompt">$</span> .</div>`;

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1920px; height:1080px; overflow:hidden; }
body { ${bg} color:${fg}; font-family:${font}; padding:80px 110px; display:flex; flex-direction:column; }
.glow { position:absolute; width:900px; height:900px; border-radius:50%; filter:blur(180px); opacity:${p.style === 'gradient' ? 0.5 : p.style === 'terminal' ? 0.22 : 0}; background:${p.accent}; top:-300px; right:-200px; pointer-events:none; }
.top { display:flex; align-items:center; gap:24px; font-size:24px; color:${subFg}; }
.top .dot { width:14px; height:14px; border-radius:50%; background:${p.accent}; }
.kicker { font-size:26px; ${kickerStyle} font-weight:600; }
.stars { margin-left:auto; font-size:26px; }
h1 { font-size:${titleSize}px; font-weight:${titleWeight}; line-height:1.15; margin-top:56px; text-transform:${titleTransform}; letter-spacing:-0.01em; }
.subtitle { font-size:32px; color:${subFg}; margin-top:28px; line-height:1.5; max-width:1300px; }
.cards { display:flex; gap:28px; margin-top:64px; flex:1; align-items:stretch; }
.card { flex:1; background:${cardBg}; border:1px solid ${cardBorder}; border-radius:20px; padding:36px 40px; }
.card-num { font-size:22px; color:${p.accent}; font-weight:700; }
.card-head { font-size:34px; font-weight:700; margin-top:14px; }
.card-body { font-size:24px; color:${subFg}; margin-top:14px; line-height:1.55; }
.cmd { margin-top:56px; background:${p.style === 'clean' ? '#111' : 'rgba(0,0,0,.45)'}; border-radius:14px; padding:26px 36px; font-size:30px; color:${p.style === 'clean' ? '#e8e8e8' : '#d2f8d2'}; width:fit-content; min-width:600px; }
.cmd-prompt { color:${p.accent}; margin-right:14px; font-weight:700; }
</style></head>
<body>
<div class="glow"></div>
<div class="top"><span class="dot"></span><span class="kicker">${esc(p.kicker)}</span><span class="stars">${esc(stars)}</span></div>
<h1>${esc(p.title)}</h1>
<div class="subtitle">${esc(p.subtitle)}</div>
<div class="cards">${cards}</div>
${cmdBlock}
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
