#!/usr/bin/env python3
"""Local Whisper transcription via faster-whisper.

Usage: python local_whisper.py <audio_path> <output_json_path>
Output JSON: { "text": str, "segments": [{startSec, endSec, text}], "durationSec": float }
"""
from __future__ import annotations
import json
import sys

def main():
    if len(sys.argv) < 3:
        print("Usage: python local_whisper.py <audio_path> <output_json_path>", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]
    output_path = sys.argv[2]

    from faster_whisper import WhisperModel
    import os
    # small (~250MB, 中文 OK, CPU 跑); 首次运行从 HF Hub 自动下载。
    # WHISPER_MODEL 可换更大模型(转写要烧进字幕, 错字会上片)。
    model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")

    # initial_prompt 定住简体输出(whisper 会跟随提示的字形), 否则中文常出繁体——
    # 字幕直接烧这份文本, 繁体/错字都会上片。可用 WHISPER_INITIAL_PROMPT 覆盖。
    initial_prompt = os.environ.get("WHISPER_INITIAL_PROMPT", "以下是普通话内容，请用简体中文转写。")
    # word_timestamps: 转写产物直接烧成字幕, 段就是字幕行 —— whisper 原生分段
    # 受 initial_prompt 影响会并成 20 秒大块, 这里按标点用词级时间戳重切成短句。
    segments_iter, info = model.transcribe(
        audio_path, beam_size=5, initial_prompt=initial_prompt, word_timestamps=True,
    )

    BREAK = set("，。？！；,.?!;")
    segments = []
    full_text_parts = []
    for s in segments_iter:
        words = list(s.words or [])
        if not words:
            segments.append({"startSec": s.start, "endSec": s.end, "text": s.text.strip()})
            full_text_parts.append(s.text.strip())
            continue
        buf, buf_start = [], None
        for w in words:
            if buf_start is None:
                buf_start = w.start
            buf.append(w)
            if w.word and w.word[-1] in BREAK:
                text = "".join(x.word for x in buf).strip().strip("，。？！；,.?!;")
                if text:
                    segments.append({"startSec": buf_start, "endSec": w.end, "text": text})
                    full_text_parts.append(text)
                buf, buf_start = [], None
        if buf:
            text = "".join(x.word for x in buf).strip().strip("，。？！；,.?!;")
            if text:
                segments.append({"startSec": buf_start, "endSec": buf[-1].end, "text": text})
                full_text_parts.append(text)

    result = {
        "text": " ".join(full_text_parts),
        "segments": segments,
        "durationSec": info.duration,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"Transcribed {len(segments)} segments, duration {info.duration:.1f}s, language={info.language}", file=sys.stderr)


if __name__ == "__main__":
    main()
