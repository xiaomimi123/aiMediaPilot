# 本目录代码来自 video-talkcraft

来源：https://github.com/Vincentwei1021/video-talkcraft（`scripts/timestamps_cpu.py`）
许可：PolyForm Noncommercial 1.0.0（见 `LICENSE-video-talkcraft`）
商用授权：本项目已取得作者书面授权函，覆盖将该脚本用于商业产品——体例与
`remotion/src/motion/README.md` 一致。

**本项目未修改 `timestamps_cpu.py`**（原样搬运）。二十九期 Task 5 只用它的
`--backend whisper` 分支（faster-whisper small/int8，安装最轻、首跑自动下载
模型，不用像默认的 FireRedASR2-CTC 那样手动下载 767MB 权重放进
`~/.cache/koubo/`），调用方式与依赖见脚本文件顶部 docstring。

## 用途

worker（`src/lib/video-production/align-captions.ts`）在 ppt-narration /
illustration-tts 两条 TTS 链路里，把已知的六幕口播稿文本（数字先转中文读法，见
`src/lib/tts/number-to-hanzi.ts`）和已合成的配音音频一起喂给这个脚本，产出
`timing.json`（字级时间戳），worker 再把词级时间挂进 `CaptionItem.words`
供 `Captions.tsx` 做逐词高亮。

对齐是增强件不是依赖件：venv 缺失 / 脚本超时(120s) / 崩溃都会被
`align-captions.ts` 捕获并退回逐句字幕（`console.warn`），不阻塞出片。

## venv

```bash
scripts/align/setup-venv.sh
```

建一个 `scripts/align/.venv`（不进 git，见根目录 `.gitignore`），装
`faster-whisper`。**首次真正跑对齐时** faster-whisper 会自动下载
`small`/`int8` 模型（约 460MB），耐心等几分钟，之后的调用直接复用本地缓存。

## 出镜链为什么不接

`talking-head-broll` 交付模式的音频是真人自由发挥的录音，没有已知文本可当
参照——ASR（`aligner-prompt.ts`）已经给出了逐句真实时间戳，字级对齐在这条链
上收益低（没有精确文本锚点，只能拿 ASR 自己的转写文本回头对自己的语音，
等于自己验自己）且多引入一次子进程调用的失败面，二十九期 Task 5 明确不接。
