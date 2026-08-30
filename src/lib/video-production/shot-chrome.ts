/**
 * 常驻框架层(二十四期)——画面上始终在场、不随内容变的四件构件。
 *
 * **动因是拆参考片拆出来的, 而且它推翻了我们对自己画面的批评。**
 *
 * 我们的成片被指「卡片龟缩左上, 右下三分之二全空」。但参考片 680 第 180 秒是同样的
 * 构图: 一张卡在左, 右边三分之二全空。它不难看, 区别在于画面上有一套始终在场的框架:
 * 左上系列号 `XILO · S040`、顶部章节标签「分析结果」、卡片编号 `01`、底部字幕、
 * 背景细网格纹理。
 *
 * **我们的空是真空** —— 这几样一个都没有, 预览阶段连字幕都没有(字幕是最后才用 ffmpeg
 * 烧的, 所以预览里的画面永远缺一块)。
 *
 * 所以正确的方向是**补框架, 不是填内容**。逼模型把画面填满是反方向, 那正是
 * `frame-detail.ts` 当初防的「大色块刷分」: 占比够了, 但那块面积里是空的。
 *
 * 放在渲染这一步而不是让 Builder 自己写: 它是每一镜都必须有的东西, 交给模型就会
 * 时有时无 —— 这个项目里凡是「让模型自觉」的规则都被违反过(环境运动层同理)。
 */

export const CHROME_MARKER = '__mp_chrome__';

export interface ChromeOpts {
  width: number;
  height: number;
  /** 这一镜属于六幕里的哪一幕。取不到(老任务/非六幕稿)就不画, 不画空标签。 */
  actLabel: string | null;
  /** 第几镜, 从 1 起。 */
  shotNo: number;
  shotTotal: number;
  /** 全片字幕。函数内部按 shotStartMs 裁到这一镜并转成相对时间。 */
  cues: { startMs: number; endMs: number; text: string }[];
  /** 这一镜在全片里的起点(毫秒)。 */
  shotStartMs: number;
}

/** 这份 HTML 挂过常驻框架了吗。 */
export function hasShotChrome(html: string): boolean {
  return html.includes(CHROME_MARKER);
}

export function buildShotChrome(opts: ChromeOpts): string {
  const { width, height } = opts;
  const short = Math.min(width, height);
  // 字号按短边取, 竖屏横屏一套代码
  const labelPx = Math.round(short * 0.022);
  const capPx = Math.round(short * 0.042);
  const pad = Math.round(short * 0.035);

  /*
   * 字幕转成**相对这一镜**的秒数: 渲染器 seek 的是镜头内的时间线, 不是全片时间轴。
   * 只保留**起点落在这一镜范围内**的那几句。
   *
   * 这条比"与这一镜有交叠"更简单, 也更符合直觉: 跨镜头边界的那一句(比如上一镜
   * 9000~10500ms、这一镜从 10000ms 起)会整句归属前一镜, 本镜开头因此可能少一句
   * 字幕 —— 但分镜本来就切在语义转折处, 一句话横跨两个镜头应当是罕见情况, 用
   * "起点在本镜内"这条简单规则换取行为可预测, 比在交叠句里各截一半更合理。
   */
  const local = opts.cues
    .filter((c) => c.startMs >= opts.shotStartMs)
    .map((c) => ({
      from: Math.max(0, (c.startMs - opts.shotStartMs) / 1000),
      to: (c.endMs - opts.shotStartMs) / 1000,
      text: c.text,
    }))
    .filter((c) => c.to > 0);

  const chapter = opts.actLabel
    ? `
  var chapter = document.createElement('div');
  chapter.className = 'chapter-label';
  chapter.textContent = ${JSON.stringify(opts.actLabel)};
  chapter.style.cssText = 'position:fixed;left:${pad}px;top:${pad}px;pointer-events:none;z-index:9990;' +
    'font-size:${labelPx}px;letter-spacing:0.15em;opacity:0.45;';
  document.body.appendChild(chapter);`
    : '';

  return `
/* ${CHROME_MARKER}: 常驻框架层 —— 章节 / 编号 / 字幕 / 纹理, 每一镜都有 */
(function () {
  var tl = window.__timelines && window.__timelines['shot'];
  if (!tl) return;

  /* 背景纹理: 极淡网格。铺在最底层, 让"空"变成"留白"而不是"真空"。 */
  var grid = document.createElement('div');
  grid.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.5;' +
    'background-image:linear-gradient(currentColor 1px, transparent 1px),' +
    'linear-gradient(90deg, currentColor 1px, transparent 1px);' +
    'background-size:${Math.round(short * 0.06)}px ${Math.round(short * 0.06)}px;' +
    'color:rgba(128,128,128,0.10);';
  document.body.insertBefore(grid, document.body.firstChild);
${chapter}

  /* 镜头编号 */
  var no = document.createElement('div');
  no.textContent = '${opts.shotNo} / ${opts.shotTotal}';
  no.style.cssText = 'position:fixed;right:${pad}px;top:${pad}px;pointer-events:none;z-index:9990;' +
    'font-size:${labelPx}px;letter-spacing:0.1em;opacity:0.35;font-variant-numeric:tabular-nums;';
  document.body.appendChild(no);

  /* 预览字幕。**预览阶段就要有** —— 现在字幕是最后用 ffmpeg 烧的, 所以预览里的
     画面永远缺底部这一块, 看起来比成片更空。这里画的只是预览用的近似, 正式字幕
     仍由 ass-captions 烧, 两者不冲突(成片走的是 master 档, 这一层同样在)。 */
  var cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:6%;right:6%;bottom:${Math.round(height * 0.08)}px;' +
    'pointer-events:none;z-index:9991;text-align:center;font-size:${capPx}px;font-weight:700;' +
    'line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.35);';
  document.body.appendChild(cap);

  var CUES = ${JSON.stringify(local)};

  /*
   * **不用 tl.call() 挂字幕**——真机验证时发现: GSAP 的 tl.seek() 默认
   * suppressEvents=true, 意思是"跳转"本身不会触发 .call() 这类回调, 只有
   * 正常播放(play/tick)经过那个时间点才会触发。而渲染器逐帧截图靠的就是
   * tl.seek(), 不是播放——用 .call() 会导致字幕在真实渲染里永远不出现,
   * 只是本地字符串体检能过, 真机是空的(这个项目里犯过好几次同类错: 写完
   * 没接线/写完不生效, 都是过了体检、没过真机)。
   *
   * 改为包一层 tl.seek: 每次渲染器 seek, 都用当前时间点重新算一遍该显示哪句
   * 字幕。这样不依赖 GSAP 回调触发时机, 渲染器怎么调都对。
   */
  var originalSeek = tl.seek.bind(tl);
  tl.seek = function (position, suppressEvents) {
    var result = originalSeek(position, suppressEvents);
    var t = typeof position === 'number' ? position : tl.time();
    var hit = null;
    for (var i = 0; i < CUES.length; i++) {
      if (t >= CUES[i].from && t < CUES[i].to) { hit = CUES[i]; break; }
    }
    cap.textContent = hit ? hit.text : '';
    return result;
  };
})();
`.trim();
}
