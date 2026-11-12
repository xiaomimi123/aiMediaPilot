// 录屏: node scripts/record.js <project.config.json> [--only=fill,template] [--shots-only] [--no-shots] [--prep-only 只试跑准备步骤]
// 应用入口: npm run -s mp -- film screenrec <config> record
// 同一持久浏览器 profile 依次执行 prep → 各 clip(CDP screencast 真实时间戳)→ 裁剪成 30fps mp4;再截 screenshots。
// 坑: 只录当前标签页(新标签不进画面); 无头没有地址栏; 帧只在画面变化时到达, 片尾静止段会变短。
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const req = (m) => {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    path.join(ROOT, 'node_modules', m),
    path.join(ROOT, '..', 'node_modules', m),
    path.join(ROOT, '..', '..', 'node_modules', m),
    m,
  ].filter(Boolean);
  for (const p of candidates) {
    try { return require(p); } catch { /* 下一个路径 */ }
  }
  throw new Error('找不到 ' + m + '。在 remotion/ 执行 npm install（依赖里有 playwright-core），或设 PLAYWRIGHT_CORE_PATH');
};
const { chromium } = req('playwright-core');
const args = process.argv.slice(2); const cfgPath = path.resolve(args[0]);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); const R = cfg.record;
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const WORK = path.resolve(ROOT, cfg.workDir); const REC = path.join(WORK, 'rec'), SHOTS = path.join(WORK, 'shots');
fs.mkdirSync(REC, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const tz = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16) + '(UTC+8)';
const sub = (s) => typeof s === 'string' ? s.replace('{url}', cfg.app.url) : s;
const loc = (p, s) => {
  if (s.sel) return p.locator(s.sel).first();
  if (s.text) return p.getByText(s.text, { exact: true }).first();
  const n = /^\/.*\/$/.test(s.name) ? new RegExp(s.name.slice(1, -1)) : s.name;
  return p.getByRole(s.role || 'button', { name: n, exact: !!s.exact }).first();
};
async function run(p, steps, ev) {
  for (const s of steps) {
    try {
      if (s.do === 'goto') await p.goto(sub(s.url), { waitUntil: 'load', timeout: 120000 });
      else if (s.do === 'wait') await p.waitForTimeout(s.ms);
      else if (s.do === 'fill') await loc(p, s).fill(s.value);
      else if (s.do === 'type') { const l = loc(p, s); await l.click(); await l.fill(''); await l.pressSequentially(s.value, { delay: s.delay ?? 50 }); }
      else if (s.do === 'click') await loc(p, s).click({ timeout: s.timeout ?? 15000 });
      else if (s.do === 'press') await p.keyboard.press(s.key);
      else if (s.do === 'waitFor') await loc(p, s).waitFor({ timeout: s.timeout ?? 30000 });
      else if (s.do === 'screenshot') await p.screenshot({ path: path.join(SHOTS, s.file) });
      else throw new Error('未知步骤 ' + s.do);
    } catch (e) { if (!s.optional) throw new Error(`步骤失败 ${JSON.stringify(s)}: ${e.message.split('\n')[0]}`); }
    if (s.event && ev) ev(s.event);
  }
}
function mkclip(w, log) {
  const dir = path.join(REC, w), fr = log.frames.sort((a, b) => a.t - b.t), t0 = fr[0].t, c = R.crop;
  let txt = 'ffconcat version 1.0\n';
  fr.forEach((a, i) => { const b = fr[i + 1]; txt += `file 'frames/${a.name}'\nduration ${((b ? b.t : a.t + 0.5) - a.t).toFixed(4)}\n`; });
  txt += `file 'frames/${fr[fr.length - 1].name}'\n`; fs.writeFileSync(path.join(dir, 'list.ffconcat'), txt);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.ffconcat'), '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y},fps=30,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(dir, `${w}.mp4`)], { stdio: 'inherit' });
  if (r.status) throw new Error('ffmpeg 失败');
  const events = log.events.map((e) => ({ ...e, t: +(e.t - t0).toFixed(3) }));
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({ video: `${w}.mp4`, dur: +(fr[fr.length - 1].t - t0 + 0.5).toFixed(3), recordedAt: log.recordedAt, events }, null, 1));
  console.log(w, 'dur', (fr[fr.length - 1].t - t0).toFixed(2), 'frames', fr.length, '录制时间', log.recordedAt); events.forEach((e) => console.log('  ', e.t, e.label));
}
(async () => {
  const meta = { recordedAt: {}, shotsAt: {}, boxes: {} };
  if (!args.includes('--shots-only')) {
    const [VW, VH] = R.viewport;
    const ctx = await chromium.launchPersistentContext(path.resolve(ROOT, R.profileDir), { executablePath: process.env.CHROME_PATH || R.chrome, args: ['--no-sandbox'], viewport: { width: VW, height: VH }, locale: 'zh-CN' });
    const p = ctx.pages()[0] || await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    let cur = null;
    cdp.on('Page.screencastFrame', async (f) => { if (cur) { const name = String(cur.frames.length).padStart(5, '0') + '.jpg'; fs.writeFileSync(path.join(cur.dir, 'frames', name), Buffer.from(f.data, 'base64')); cur.frames.push({ name, t: f.metadata.timestamp }); } await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    await run(p, R.prep); console.log('prep 完成');
    if (args.includes('--prep-only')) { await ctx.close(); return; }
    for (const [w, steps] of Object.entries(R.clips)) {
      if (only.length && !only.includes(w)) continue;
      if (R.between?.[w]) await run(p, R.between[w]);
      const dir = path.join(REC, w); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
      cur = { dir, frames: [], events: [], recordedAt: tz() };
      const ev = (label) => cur.events.push({ t: Date.now() / 1000, label });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW, maxHeight: VH });
      await p.waitForTimeout(700); ev('start'); await run(p, steps, ev); await p.waitForTimeout(800); ev('end');
      await cdp.send('Page.stopScreencast'); const log = cur; cur = null; mkclip(w, log); meta.recordedAt[w] = log.recordedAt;
    }
    await ctx.close();
  }
  if (!args.includes('--no-shots')) {
    const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || R.chrome, args: ['--no-sandbox'] });
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    for (const s of R.screenshots || []) {
      await p.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(s.wait ?? 3000);
      if (s.scrollTo) { await p.locator(s.scrollTo).first().scrollIntoViewIfNeeded(); await p.evaluate((y) => window.scrollBy(0, y), s.scrollOffset ?? 0); await p.waitForTimeout(800); }
      if (s.boxOf) meta.boxes[s.name] = await p.locator(s.boxOf).first().boundingBox();
      await p.screenshot({ path: path.join(SHOTS, s.name + '.png') }); meta.shotsAt[s.name] = tz();
      console.log('shot', s.name, meta.shotsAt[s.name], s.source ? `→ 请把这个时间填到 sources.${s.source}` : '');
    }
    await b.close();
  }
  fs.writeFileSync(path.join(WORK, 'capture.json'), JSON.stringify(meta, null, 1));
  console.log('采集时间/坐标写在', path.join(WORK, 'capture.json'), '(build 不会自动改 sources, 由人核对后填)');
})().catch((e) => { console.error(e.message); process.exit(1); });
