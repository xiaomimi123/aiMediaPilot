/**
 * 环境运动层(二十三期)——让任何一帧都不完全静止。
 *
 * **动因是量出来的, 不是感觉。** 接上静止段检测之后第一次扫全片:
 *
 *   参考片 0%  |  真人口播成片 0%  |  **真人出镜+B-roll 94%**  |  **插画配音 86%**
 *
 * 我们的 AI 画面基本上是静止图片: Builder 写的 GSAP 时间线在头一两秒把元素放进来,
 * 然后在剩下的二三十秒里一动不动。而我此前做的四道画面关(空屏/空壳/版面/裁字)
 * **全部是逐帧判的**, 对这件事完全没有感知 —— 每一帧都合格, 整段却是死的。
 *
 * 思路取自 video-talkcraft 的「七层反 PPT 系统」(用户已取得作者商业授权), 它的
 * 环境层注释写得很准: 「低振幅全片运行, 让没有任何一帧是完全静止的」。它是 Remotion
 * 组件, 我们的管线是 HTML + GSAP + 无头浏览器截图, 所以这里是按同一原理自己写的
 * GSAP 版本, 不是移植代码。
 *
 * 三条设计约束, 每条都有理由:
 * 1. **挂在同一条 `__timelines.shot` 上** —— 渲染器靠 seek 这条时间线逐帧截图,
 *    挂在别处的动画在截图时是不动的(它只在真实播放时才走)。
 * 2. **覆盖整段时长** —— 只在开头动几秒等于没解决问题, 后半段照样是死的。
 * 3. **振幅要小** —— scale 上限 1.06、位移几个像素。再大就成了晃镜头, 观众会晕,
 *    而且会把内容顶出安全区。
 */

/** 挂过环境层的 HTML 里会有这个标记, 供校验回查。 */
export const AMBIENT_MARKER = '__mp_ambient__';

export interface AmbientOpts {
  width: number;
  height: number;
  durationMs: number;
}

/**
 * 生成一段自包含的 JS, 追加到镜头 HTML 的时间线之后。
 *
 * 只碰 `document.body` 的 transform 和一个自建的渐变层, 不改任何业务元素 ——
 * Builder 写的排版必须原样保留, 这一层只是让它整体轻微地活着。
 */
export function buildAmbientRig(opts: AmbientOpts): string {
  const sec = Math.max(1, opts.durationMs / 1000);
  // 位移按画幅取, 竖屏窄, 横向不能给太多
  const drift = Math.round(Math.min(opts.width, opts.height) * 0.006);

  return `
/* ${AMBIENT_MARKER}: 环境运动层 —— 低振幅全片运行, 保证没有任何一帧完全静止 */
(function () {
  var tl = window.__timelines && window.__timelines['shot'];
  if (!tl || !window.gsap) return;

  /* 相机层: 一条覆盖整段的连续曲线。用 body 的子容器而不是 body 本身 ——
     body 上有背景色, 缩放它会露出边。 */
  var stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;inset:0;pointer-events:none;transform-origin:50% 50%;';
  while (document.body.firstChild) stage.appendChild(document.body.firstChild);
  document.body.appendChild(stage);
  stage.style.position = 'static';
  stage.style.transformOrigin = '50% 50%';

  tl.to(stage, {
    scale: 1.045,
    x: ${drift},
    y: ${-drift},
    duration: ${sec.toFixed(2)},
    ease: 'none',
  }, 0);

  /* 环境层: 呼吸式暗角。
     **ease 必须是 'none'(三角波), 不能用 sine.inOut。** 实测: 用 sine.inOut 时
     每个换向点速度归零, 那一瞬画面真的不动 —— 静止检测报出三段 0.8 秒(正好等于
     检测门槛), 位置就落在换向点上。三角波换向是拐点不是平台, 速度恒定不为零。 */
  var vig = document.createElement('div');
  vig.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;' +
    'background:radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%);';
  document.body.appendChild(vig);
  gsap.set(vig, { opacity: 0.55 });
  tl.to(vig, {
    opacity: 0.95,
    duration: 2.1,
    ease: 'none',
    yoyo: true,
    repeat: Math.max(1, Math.ceil(${sec.toFixed(2)} / 2.1)),
  }, 0);

  /* 第二个分量, 周期与暗角**互质**且错相: 两层同时处在换向点的概率极低。
     单靠一层周期运动, 换向点必然周期性地制造静止帧。 */
  var glow = document.createElement('div');
  glow.style.cssText =
    'position:fixed;inset:-10%;pointer-events:none;z-index:9998;' +
    'background:linear-gradient(115deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0) 60%);';
  document.body.appendChild(glow);
  gsap.set(glow, { xPercent: -12 });
  tl.to(glow, {
    xPercent: 12,
    duration: 3.7,
    ease: 'none',
    yoyo: true,
    repeat: Math.max(1, Math.ceil(${sec.toFixed(2)} / 3.7)),
  }, 0.9);
})();
`.trim();
}

/** 这份 HTML 挂过环境层了吗。 */
export function hasAmbientRig(html: string): boolean {
  return html.includes(AMBIENT_MARKER);
}
