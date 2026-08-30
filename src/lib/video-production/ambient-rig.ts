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
 * ## 决定性的量是「任意 0.8 秒窗口内的变化速率」, 不是振幅, 也不是瞬时速度
 *
 * 这一节是三次实测改出来的, 前两次判断都错了, 都记在这里。
 *
 * `freezedetect` 拿每一帧跟**这段静止的第一帧**比, 不是跟相邻帧比。所以它真正在问
 * 的是: 「相对参考帧, 在 0.8 秒里累计变出去了多少」。
 *
 * - **第一次判断(错)**: 以为问题在 `sine.inOut` 的换向点速度归零, 改成 `none` 三角波。
 *   改完整片仍有 1.13 秒静止, 位置正好夹着暗角层第一次换向的 2.1 秒 —— 说明换掉 ease
 *   并没有解决换向本身: 位置走出去又走回来, 累计变化被自己抵消。
 * - **第二次判断(也错)**: 于是把所有分量都改成单调不回头, 暗角从 2.1 秒呼吸改成整段
 *   单向渐深。**整片从 1 段 1.13 秒恶化到 13 段 13.3 秒。** 因为单调化的同时把速率也
 *   压没了: 0.4 的透明度摊到 10 秒, 任意 0.8 秒里只变 0.03, 处处低于门槛。
 * - **实测结论**: 速率是主项, 往返只是在换向点附近开一个局部的洞。所以正确组合是
 *   **高速率的往返层 + 一个足够强的单调层去补那个洞**, 两者缺一不可。镜头级 A/B
 *   (同一镜 10 秒, 四个变体各渲一遍):
 *
 *     暗角往返 2.1s + 无扫光            → 静止 1.03s
 *     全单调(暗角摊到整段) + 扫光 0.05  → 静止 3.73s
 *     暗角往返 2.1s + 扫光 0.12         → **静止 0.00s**
 *
 *   扫光透明度是一路试下来的: 0.06 / 0.08 在最难的那一镜上仍留 0.8~1.0 秒, 0.12 才归零。
 *
 * ## 其余三条设计约束
 * 1. **挂在同一条 `__timelines.shot` 上** —— 渲染器靠 seek 这条时间线逐帧截图,
 *    挂在别处的动画在截图时是不动的(它只在真实播放时才走)。
 * 2. **覆盖整段时长** —— 只在开头动几秒等于没解决问题, 后半段照样是死的。
 * 3. **振幅要小** —— scale 上限 1.045、位移几个像素、扫光透明度 0.05。再大就成了
 *    晃镜头, 观众会晕, 而且会把内容顶出安全区。
 */

/** 挂过环境层的 HTML 里会有这个标记, 供校验回查。 */
export const AMBIENT_MARKER = '__mp_ambient__';

/** 扫光条纹的一个周期宽度(px)。平移整数倍周期时图案与初始完全重合, 循环无缝。 */
export const SHEEN_TILE_PX = 480;
/** 扫光走完一个周期用多久(秒)。越短速率越高, 但过快会看出流光。 */
export const SHEEN_CYCLE_SEC = 2.4;
/** 扫光条纹峰值透明度。**0.12 是实测下限**: 0.06/0.08 在最难的镜头上仍留约 1 秒静止。 */
export const SHEEN_ALPHA = 0.12;
/** 暗角呼吸一程用多久(秒)。这一层提供的是**速率**, 周期越短速率越高。 */
export const VIGNETTE_PERIOD_SEC = 2.1;

export interface AmbientOpts {
  width: number;
  height: number;
  durationMs: number;
}

/**
 * 生成一段自包含的 JS, 追加到镜头 HTML 的时间线之后。
 *
 * 只碰一个自建的舞台容器和两个自建的渐变层, 不改任何业务元素 ——
 * Builder 写的排版必须原样保留, 这一层只是让它整体轻微地活着。
 */
export function buildAmbientRig(opts: AmbientOpts): string {
  const sec = Math.max(1, opts.durationMs / 1000);
  // 位移按画幅取, 竖屏窄, 横向不能给太多
  const drift = Math.round(Math.min(opts.width, opts.height) * 0.006);
  // 扫光跑满整段需要多少个周期。取整数周期, 每个周期恰好平移一格, 接缝不可见。
  const sheenCycles = Math.max(1, Math.ceil(sec / SHEEN_CYCLE_SEC));
  const vigRepeat = Math.max(1, Math.ceil(sec / VIGNETTE_PERIOD_SEC));

  return `
/* ${AMBIENT_MARKER}: 环境运动层 —— 低振幅全片运行, 高速率往返层 + 单调补洞层 */
(function () {
  var tl = window.__timelines && window.__timelines['shot'];
  if (!tl || !window.gsap) return;

  /* 相机层: 一条覆盖整段的连续曲线, 单调推进。用 body 的子容器而不是 body 本身 ——
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

  /* 暗角层: 高速率呼吸 —— 三层里**速率**最高的一层, 静止检测主要靠它扛。
     ease 用 'none' 三角波而非 sine.inOut: 后者在换向点速度归零, 那一瞬真的不动。
     它是往返的, 换向点附近会留一个洞, 那个洞交给下面单调的扫光层补。 */
  var vig = document.createElement('div');
  vig.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;' +
    'background:radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%);';
  document.body.appendChild(vig);
  gsap.set(vig, { opacity: 0.5 });
  tl.to(vig, {
    opacity: 0.95,
    duration: ${VIGNETTE_PERIOD_SEC},
    ease: 'none',
    yoyo: true,
    repeat: ${vigRepeat},
  }, 0);

  /* 扫光层: 周期性条纹匀速平移, 每周期整走一格 —— **位置永远向前, 没有换向点**。
     它单独用不够(全单调那一版更差), 但它正好覆盖暗角换向的那一瞬 —— 补洞的就是它。 */
  var sheen = document.createElement('div');
  sheen.style.cssText =
    'position:fixed;inset:-40%;pointer-events:none;z-index:9998;transform:rotate(-22deg);' +
    'background-image:repeating-linear-gradient(90deg,' +
      ' rgba(255,255,255,0) 0px,' +
      ' rgba(255,255,255,${SHEEN_ALPHA}) ${Math.round(SHEEN_TILE_PX / 2)}px,' +
      ' rgba(255,255,255,0) ${SHEEN_TILE_PX}px);';
  document.body.appendChild(sheen);
  gsap.set(sheen, { backgroundPositionX: '0px' });
  tl.to(sheen, {
    backgroundPositionX: '${SHEEN_TILE_PX}px',
    duration: ${SHEEN_CYCLE_SEC},
    ease: 'none',
    repeat: ${sheenCycles},
  }, 0);
})();
`.trim();
}

/** 这份 HTML 挂过环境层了吗。 */
export function hasAmbientRig(html: string): boolean {
  return html.includes(AMBIENT_MARKER);
}
