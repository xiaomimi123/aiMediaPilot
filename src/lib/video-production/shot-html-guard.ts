export interface ShotHtmlCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 分镜 HTML 的落盘前体检(二十一期)。
 *
 * 动因: 渲染阶段才发现 HTML 不合格的代价极高 —— 一条 18 镜的片子要跑十几分钟、
 * 几十次 LLM 调用, 任何一镜的产物坏掉就整条任务失败, 前面所有镜头的算力全废。
 * 五次真实出片里踩中两次:
 *   1. Builder 漏写 `window.__timelines["shot"] = tl`(渲染器靠它 seek 截帧)
 *   2. Builder 没写代码, 在 <script> 里写了一段"我们应该改用伪元素…现在重写代码"
 *      的自言自语就闭合了
 *
 * 这里只做**确定性的形状检查**, 不做语义判断 —— 目的是把"一次生成翻车"从
 * "整条任务失败"降级成"这一镜重来一次"。
 */
export function validateShotHtml(html: string): ShotHtmlCheck {
  const s = (html ?? '').trim();

  if (!s) return { ok: false, reason: '产出为空' };

  // 提示词明令不许用 markdown 包裹; 包裹了会让 <!DOCTYPE 不在开头, 浏览器解析异常
  if (s.startsWith('```')) return { ok: false, reason: '被 markdown 代码块包裹' };

  if (!/<\/html>\s*$/i.test(s)) return { ok: false, reason: 'HTML 不完整或被截断(缺少结尾 </html>)' };

  if (!/gsap\.min\.js/i.test(s)) return { ok: false, reason: '缺少本地 gsap.min.js 引用' };

  // 两种引号都接受 —— 实测模型两种都会用
  if (!/__timelines\s*\[\s*['"]shot['"]\s*\]\s*=/.test(s)) {
    return { ok: false, reason: '缺少 window.__timelines["shot"] 挂载, 渲染器无法 seek 截帧' };
  }

  return { ok: true };
}
