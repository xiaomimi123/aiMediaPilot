# 产品录屏3D

横版 1920×1080，配置驱动。换项目主要是新建 `projects/<名>/project.config.json`（`formatTag` 保持「产品录屏3D」），不要改 `src/Film.tsx`。渲染走仓库已有的 `remotion/scripts/render.ts`：`mp film render <配置>` 和下面的 `render` 是同一条。

竖版抖音成片仍走风格 D，安全区不在这里改。

范例 `projects/invoify/project.config.json` 是已接受的 Invoify 成片镜头表。上屏数字和采集时间以 `sources` 为准（GitHub 星数 6.4k，API 6383，采集 2026-11-04 17:37 UTC+8）。不要改成没出处的数。里面的本机路径（`app.startCmd`、`record.chrome`、`cleanup.dirs`）要换成你自己的。

## 准备

- Node 20+、ffmpeg、Google Chrome、Python 3.10+。
- 仓库根目录 `npm install`；`cd remotion && npm install`（含 playwright-core）。
- 配音和转写校验：`pip install numpy requests pillow faster-whisper`。
- 环境变量只放本机 `.env`，不要写进配置或提交：`VOLC_APPID`、`VOLC_ACCESS_TOKEN`、`VOLC_SPEAKER_ID`。可选 `VOLC_RESOURCE_ID`（默认 seed-icl-2.0）、`CHROME_PATH`（不设就用配置里的 `record.chrome`）。缺变量时脚本只报名字。
- 先把被录的网页跑起来。视口 1920×1146，ffmpeg 裁掉顶部 66px，得到 1920×1080（去掉 Next dev 标）。地址栏是画出来的，画面上要注明。

## 命令

在仓库根目录。`<配置>` 例如 `remotion/screenrec/projects/invoify/project.config.json`。

```bash
npm run -s mp -- film screenrec <配置> record          # 可加 --prep-only、--only fill,template
npm run -s mp -- film screenrec <配置> voice --check
npm run -s mp -- film screenrec <配置> build
npm run -s mp -- film screenrec <配置> render --keys   # 或 --keys 0,1,4
npm run -s mp -- film screenrec <配置> render --film   # 或 --film <输出目录>
npm run -s mp -- film screenrec <配置> verify <成片.mp4>
npm run -s mp -- film screenrec <配置> cleanup         # 只打印，不删除
```

等价：`npm run screenrec -- <配置> <步骤>`。只渲时也可以 `npm run -s mp -- film render <配置>`（加 `--stills` 出关键帧）。脚本直接跑：`node remotion/screenrec/scripts/record.js <配置>`，`python3 remotion/screenrec/scripts/voice.py <配置>`，`node remotion/screenrec/scripts/render.mjs <配置> --keys`。

`record` 把截图时间写到 `work/capture.json`。把核对过的时间手填进 `sources`（UTC+8，到分钟）。重跑 voice/build 不会改 `sources`。

成片默认在 `remotion/screenrec/out/<name>_产品录屏3D_trialN_1920x1080.mp4`（可用 `FILMS_DIR` 或 `--film` 改目录）。`work/`、`out/`、浏览器 profile、成片都不入库。

## 配置里要有的

- `app.url`：被录页面。`record.prep` / `clips` / `between`：`do` 为 goto、wait、fill、type、click、press、waitFor、screenshot。
- `record.viewport` + `crop`：先录高一点再裁。`recMasks`：录屏上盖掉的色块。
- `shots[]`：`kind` 为 hook、github、rec、readme、end。口播在 `lines`。贴纸时间可写 `["line", 1, 0.6]`、`["end", 1.8]`、`["toEnd", 0.2]`。
- `sources`：上屏数字的出处和采集时间，文案里用 `{githubAt}` 这类占位。
- `voice.pronounce`：只改送去合成的读音，字幕仍是原文。
- `cleanup`：发布后想卸掉的目录和进程。命令只列出。

没有火山克隆音色时，可以 `voice --import-props <props.json> --import-mp3 <narr.mp3>` 复用已有配音，再 build、render。
