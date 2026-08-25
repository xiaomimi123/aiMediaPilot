import { describe, expect, it } from 'vitest';
import { validateShotHtml } from '@/lib/video-production/shot-html-guard';

const GOOD = `<!DOCTYPE html><html><head></head><body><div id="a"></div>
<script src='gsap.min.js'></script>
<script>
const tl = gsap.timeline({ paused: true });
tl.to('#a', { opacity: 1, duration: 1 });
window.__timelines["shot"] = tl;
</script></body></html>`;

describe('validateShotHtml', () => {
  it('合格的分镜 HTML 通过', () => {
    expect(validateShotHtml(GOOD).ok).toBe(true);
  });

  it('单引号写法同样合格 —— 实测模型两种引号都会用', () => {
    expect(validateShotHtml(GOOD.replace('__timelines["shot"]', "__timelines['shot']")).ok).toBe(true);
  });

  it('缺时间线挂载 → 不合格(真实出片踩过: 渲染时报 __timelines[shot] 不存在)', () => {
    const bad = GOOD.replace('window.__timelines["shot"] = tl;', '');
    const r = validateShotHtml(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/__timelines|时间线/);
  });

  it('模型写成自言自语的思考而非代码 → 不合格(真实出片踩过: 镜头 11)', () => {
    const rambling = `<!DOCTYPE html><html><body><script src='gsap.min.js'></script><script>
// 因此我们去掉 strike-line div, 改用伪元素。
// 现在重写代码。
</script></body></html>`;
    expect(validateShotHtml(rambling).ok).toBe(false);
  });

  it('缺 gsap 引用 → 不合格(渲染器依赖本地 gsap.min.js)', () => {
    const r = validateShotHtml(GOOD.replace("<script src='gsap.min.js'></script>", ''));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/gsap/i);
  });

  it('没有闭合 </html> → 不合格(输出被截断)', () => {
    const r = validateShotHtml(GOOD.replace('</html>', ''));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/截断|完整|html/i);
  });

  it('空字符串 → 不合格, 不抛异常', () => {
    expect(validateShotHtml('').ok).toBe(false);
  });

  it('被 markdown 代码块包裹 → 不合格(提示词明令不许包裹)', () => {
    const r = validateShotHtml('```html\n' + GOOD + '\n```');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/markdown|代码块/);
  });
});

describe('脚本语法体检(真实出片踩过: 颜色值没加引号导致整段 JS 不执行)', () => {
  it('脚本有语法错误 → 不合格', () => {
    const bad = `<!DOCTYPE html><html><body><script src='gsap.min.js'></script><script>
const tl = gsap.timeline({ paused: true });
const c = splitChars(el, #1F1F1F);
window.__timelines["shot"] = tl;
</script></body></html>`;
    const r = validateShotHtml(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/语法/);
  });

  it('语法正确的脚本照常通过', () => {
    expect(validateShotHtml(GOOD).ok).toBe(true);
  });

  it('含现代语法(可选链/展开/模板串)不误判', () => {
    const modern = `<!DOCTYPE html><html><body><script src='gsap.min.js'></script><script>
const tl = gsap.timeline({ paused: true });
const o = { a: 1 }; const p = { ...o }; const q = o?.a ?? 0;
tl.to('#x', { opacity: q, duration: \`\${p.a}\` });
window.__timelines['shot'] = tl;
</script></body></html>`;
    expect(validateShotHtml(modern).ok).toBe(true);
  });

  it('没有 <script> 块时不因语法检查误报', () => {
    const noScript = `<!DOCTYPE html><html><body><script src='gsap.min.js'></script><script>window.__timelines["shot"]=1;</script></body></html>`;
    expect(validateShotHtml(noScript).ok).toBe(true);
  });
});
