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
    # small (~250MB, 中文 OK, CPU 跑); 首次运行从 HF Hub 自动下载
    model = WhisperModel("small", device="cpu", compute_type="int8")

    segments_iter, info = model.transcribe(audio_path, beam_size=5)  # 自动语言检测

    segments = []
    full_text_parts = []
    for s in segments_iter:
        segments.append({
            "startSec": s.start,
            "endSec": s.end,
            "text": s.text.strip(),
        })
        full_text_parts.append(s.text.strip())

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
