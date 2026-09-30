#!/usr/bin/env bash
# 二十九期 Task 5: 给 timestamps_cpu.py 建一个独立 venv。
#
# 只装 faster-whisper（--backend whisper 分支）——这是 timestamps_cpu.py
# docstring 里"安装最轻"的选项，不用像默认的 FireRedASR2-CTC 那样手动下载
# 767MB 模型放进 ~/.cache/koubo/。faster-whisper 首次真正对齐时会自己下载
# small/int8 模型（约 460MB），这一步不会触发下载，下载发生在第一次真跑对齐时。
#
# venv 与模型都不进 git（见根目录 .gitignore 里的 scripts/align/.venv）。
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[align] 创建 venv: scripts/align/.venv"
  python3 -m venv .venv
fi

echo "[align] 安装 faster-whisper（不会触发模型下载，模型在首次真跑对齐时才下载）"
.venv/bin/pip install --upgrade pip
.venv/bin/pip install faster-whisper zhconv pypinyin

echo "[align] 完成。首次真跑对齐（scripts/align/timestamps_cpu.py ... --backend whisper）"
echo "        会自动下载 whisper small/int8 模型，约 460MB，可能要几分钟，耐心等。"
