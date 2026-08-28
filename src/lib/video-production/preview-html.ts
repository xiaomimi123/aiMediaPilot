/**
 * 把 Builder 产出的镜头 HTML 变成**浏览器里能直接看的预览页**(二十三期)。
 *
 * 这件事之所以可能, 是因为管线的中间产物本来就是一个自包含的 HTML 页 —— 渲染
 * 那一步只是用无头浏览器逐帧截图再交给 ffmpeg。既然浏览器能截它, 浏览器当然也能
 * 直接放它。**调模板不需要等三分钟的 ffmpeg**。
 *
 * 两处必须改写, 否则 iframe 里是一片空白:
 *
 * 1. `<script src="gsap.min.js">` 指的是渲染工作目录里的本地文件, iframe 里没有那个
 *    路径。把 gsap 源码内联进去。
 * 2. Builder 按契约产出的是**暂停态**时间线(`window.__timelines["shot"]`),
 *    渲染器靠 `tl.seek()` 逐帧截图, 所以它自己不会动。预览要主动播它。
 */

/** Builder 契约里写死的引用方式。改这里之前先看 builder-prompt.ts 的技术契约。 */
const GSAP_TAG = /<script\s+src=["']gsap\.min\.js["']\s*>\s*<\/script>/i;

export interface PreviewOptions {
  /** gsap.min.js 的源码。由调用方读盘传入 —— 这个模块保持纯函数, 好测。 */
  gsapSource: string;
  /** 镜头时长(毫秒), 用来给进度条定量程。 */
  durationMs: number;
  /** 播完是否回到开头重播。调画面时循环看更方便。 */
  loop?: boolean;
}

/**
 * 播放器脚本。挂在页面最后, 等 Builder 的时间线建好再接管。
 *
 * **轮询等待而不是假设时间线已经就绪**: Builder 产出的脚本可能在 DOMContentLoaded
 * 之后才建时间线, 直接取会拿到 undefined, 表现是一个永远不动的画面 —— 而那看起来
 * 和「这一镜就是静止的」一模一样, 极难判断。
 */
function playerScript(durationMs: number, loop: boolean): string {
  return `
<script>
(function () {
  var DURATION = ${durationMs};
  var LOOP = ${loop ? 'true' : 'false'};
  var tries = 0;
  function ready() {
    var tl = window.__timelines && window.__timelines['shot'];
    if (!tl) {
      // 最多等 5 秒。等不到就把原因显示出来, 而不是留一个静止的画面让人猜。
      if (++tries > 100) {
        var w = document.createElement('div');
        w.style.cssText = 'position:fixed;left:0;right:0;top:0;padding:8px 12px;background:#7f1d1d;color:#fff;font:14px/1.5 sans-serif;z-index:99999';
        w.textContent = '这一镜没有建出 window.__timelines["shot"] —— 渲染时会失败，需要重新生成画面。';
        document.body.appendChild(w);
        return;
      }
      return setTimeout(ready, 50);
    }
    window.__preview = tl;
    tl.play(0);
    if (LOOP) tl.eventCallback('onComplete', function () { tl.play(0); });
    // 把当前进度报给外层, 外层用它画进度条
    setInterval(function () {
      try {
        parent.postMessage({ type: 'preview-progress', t: tl.time(), d: DURATION / 1000 }, '*');
      } catch (e) {}
    }, 100);
  }
  window.addEventListener('message', function (e) {
    var tl = window.__preview;
    if (!tl || !e.data) return;
    if (e.data.type === 'preview-seek') tl.pause().seek(e.data.t);
    if (e.data.type === 'preview-play') tl.play();
    if (e.data.type === 'preview-pause') tl.pause();
  });
  ready();
})();
</script>`;
}

/**
 * 生成可预览的 HTML。
 *
 * 找不到 gsap 引用时**不静默跳过**: 那说明 Builder 没按契约输出, 渲染那一步一样
 * 会失败。把 gsap 补在 `</head>` 前, 让预览照样能跑, 但这件事值得调用方知道 ——
 * 所以返回 `patched` 标记。
 */
export function buildPreviewHtml(
  builderHtml: string,
  opts: PreviewOptions,
): { html: string; gsapInlined: boolean } {
  const inline = `<script>${opts.gsapSource}</script>`;
  let html = builderHtml;
  let gsapInlined = false;

  if (GSAP_TAG.test(html)) {
    html = html.replace(GSAP_TAG, inline);
    gsapInlined = true;
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${inline}</head>`);
  } else {
    html = `${inline}${html}`;
  }

  const player = playerScript(opts.durationMs, opts.loop ?? true);
  html = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${player}</body>`)
    : `${html}${player}`;

  return { html, gsapInlined };
}
