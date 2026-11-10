import type { StructuredLLM } from '@/lib/script/write';
import { z } from 'zod';

/**
 * 快讯档封面: 1080×1440(4:3, 抖音信息流展示面积大), 视觉走风格 D「章节档案」
 * (暖白点阵纸 + 粉强调 + 黑描边大字, 与竖版成片一致, 用户 2026-11-10 定的)。
 * 渲染走 demo-page 同款链路: HTML 模板 + Playwright 截图, 不依赖 Remotion。
 */

const CoverCopySchema = z.object({
  coverText: z.array(z.string().min(1).max(14)).min(1).max(2),
  kicker: z.string().min(1).max(16),
  sub: z.string().min(1).max(40),
  pick: z.enum(['points', 'command', 'plain']),
  points: z.array(z.string().min(1).max(16)).max(3),
  command: z.string().max(80),
});
export type CoverCopy = z.infer<typeof CoverCopySchema>;

const SYSTEM_PROMPT = `你是抖音封面设计师。为开源项目快讯视频设计封面文案, 视觉模板是固定的(暖白点阵纸+粉强调色+黑描边大字), 你只填文字。
- coverText: 封面主大字, 1~2 行每行不超过 12 字。要让人在信息流里 1 秒看懂「这是什么+为什么厉害」, 用大白话, 可以口语夸张但不编造。
- kicker: 顶部小标签(栏目名, 如「开源快讯」或项目类别)。
- sub: 大字下面的一行副标(具体说明, 不超过 36 字)。
- pick 三选一决定底部展示什么:
  - points: README 里最抓人的 2~3 个短点(每个不超过 14 字), 适合功能有记忆点的项目
  - command: 一条安装/运行命令(不超过 60 字符), 适合开发者工具
  - plain: 都不放(封面干净), 适合上面已经足够抓人的
- 数字(stars 等)会自动显示, 不用你管。只输出 JSON。`;

export async function designCoverCopy(opts: { llm: StructuredLLM; repo: string; starCount: number | null; readme: string; scriptText?: string }): Promise<CoverCopy> {
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      {
        type: 'text',
        text: `【仓库】${opts.repo}${opts.starCount !== null ? `（GitHub ${opts.starCount.toLocaleString('en-US')} stars）` : ''}\n【README 摘录】\n${opts.readme.slice(0, 2000)}${opts.scriptText ? `\n【本条视频口播稿】\n${opts.scriptText.slice(0, 800)}` : ''}\n设计封面文案。`,
      },
    ],
    responseSchema: CoverCopySchema,
  });
  return result;
}

const PAPER = '#F4EFE6';
const DOT = '#D8CFBF';
const INK = '#151515';
const MUTED = '#8B8476';
const PINK = '#E6307F';

/** 风格 D 封面模板: 点阵纸底 + 顶部栏目条 + 黑描边大字 + 底部卖点/命令 */
export function renderCoverHtml(p: CoverCopy, o: { repo: string; starCount: number | null; brand?: string }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = p.coverText.map((l) => `<div class="line"><span>${esc(l)}</span></div>`).join('');
  const stars = o.starCount !== null ? `${o.starCount.toLocaleString('en-US')} ★` : '';
  const starsHtml = stars ? `<span class="stars">${stars}</span>` : '';

  let bottom = '';
  if (p.pick === 'points' && p.points.length) {
    bottom = `<div class="points">${p.points.map((pt, i) => `<div class="pt"><span class="pt-no">${String(i + 1).padStart(2, '0')}</span><span>${esc(pt)}</span></div>`).join('')}</div>`;
  } else if (p.pick === 'command' && p.command) {
    bottom = `<div class="cmd"><span class="dollar">$</span>${esc(p.command)}</div>`;
  }

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1440px; overflow:hidden; }
body { background:${PAPER}; color:${INK}; font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;
  background-image: radial-gradient(${DOT} 2.2px, transparent 2.4px); background-size:34px 34px;
  padding:64px 76px 108px; display:flex; flex-direction:column; position:relative; }
.top { display:flex; align-items:center; gap:20px; font-family:Menlo,monospace; font-size:26px; }
.tag { background:${INK}; color:${PAPER}; padding:10px 26px; font-weight:700; letter-spacing:2px; }
.stars { margin-left:auto; font-weight:700; color:${PINK}; }
.title { margin-top:84px; }
.line { margin-bottom:22px; }
.line span {
  display:inline-block; font-size:108px; line-height:1.2; font-weight:900; color:${INK};
  padding:6px 28px; background:${PAPER};
  box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.line:first-child span { border-left:14px solid ${PINK}; }
.sub { margin-top:36px; font-size:34px; line-height:1.6; color:${INK}; opacity:.72; max-width:900px; }
.bottom { margin-top:auto; }
.points { display:flex; flex-direction:column; gap:20px; }
.pt { display:flex; align-items:center; gap:22px; background:#fff; border:3px solid ${INK}; box-shadow:8px 8px 0 ${INK}; padding:22px 34px; font-size:36px; font-weight:700; }
.pt-no { font-family:Menlo,monospace; color:${PINK}; font-size:30px; }
.cmd { background:${INK}; color:#E8E4D8; font-family:Menlo,monospace; font-size:34px; padding:28px 38px; border-radius:16px; }
.dollar { color:${PINK}; margin-right:18px; font-weight:700; }
.brand { position:absolute; right:76px; bottom:40px; font-family:Menlo,monospace; font-size:24px; color:${MUTED}; }
.repo { position:absolute; left:76px; bottom:40px; font-family:Menlo,monospace; font-size:24px; color:${MUTED}; }
</style></head>
<body>
<div class="top"><span class="tag">${esc(p.kicker)}</span>${starsHtml}</div>
<div class="title">${title}</div>
<div class="sub">${esc(p.sub)}</div>
<div class="bottom">${bottom}</div>
<span class="repo">${esc(o.repo)}</span>
<span class="brand">${esc(o.brand ?? '亲测档案')}</span>
</body></html>`;
}
