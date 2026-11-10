"""逐句合成旁白,裁掉首尾静音,拼成 narr.mp3,并给出字幕和卡片时间轴。

默认火山克隆音色。`--tts edge` 或 TTS_ENGINE=edge 改用免费 edge-tts。
"""
import asyncio
import base64
import hashlib
import os
import re
import subprocess
import uuid
import wave
from pathlib import Path

import numpy as np

SR = 24000


def _spoken(text: str, pron: dict) -> str:
    for key, value in pron.items():
        text = text.replace(key, value)
    return text


def _ffmpeg_pcm(audio: bytes) -> np.ndarray:
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "-", "-ar", str(SR), "-ac", "1", "-f", "s16le", "-"],
        input=audio,
        capture_output=True,
    )
    if proc.returncode != 0 or not proc.stdout:
        err = proc.stderr.decode("utf-8", "replace")[-400:]
        raise SystemExit("ffmpeg 解码配音失败。" + err)
    return np.frombuffer(proc.stdout, dtype=np.int16).copy()


def _write_wav(path: Path, pcm: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def _read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as handle:
        return np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).copy()


def _tidy(pcm: np.ndarray, maxgap=0.5, keep=0.4, edge=0.05) -> np.ndarray:
    """按 10ms 能量去掉首尾静音,并把句内超过 maxgap 的停顿压到 keep。"""
    if len(pcm) < SR // 10:
        return pcm
    frame = SR // 100
    count = len(pcm) // frame
    energy = np.sqrt((pcm[: count * frame].astype(np.float32).reshape(count, frame) ** 2).mean(1))
    voiced = energy > max(250.0, float(energy.max()) * 0.03)
    idx = np.where(voiced)[0]
    if len(idx) == 0:
        return pcm[: int(0.2 * SR)]
    start = max(0, int(idx[0]) - int(edge * 100))
    end = min(count, int(idx[-1]) + 1 + int(edge * 100))
    pieces = []
    i = start
    while i < end:
        if not voiced[i]:
            j = i
            while j < end and not voiced[j]:
                j += 1
            length = (j - i) / 100
            if length > maxgap:
                pieces.append(pcm[i * frame : (i + int(keep * 100)) * frame])
            else:
                pieces.append(pcm[i * frame : j * frame])
            i = j
        else:
            j = i
            while j < end and voiced[j]:
                j += 1
            pieces.append(pcm[i * frame : j * frame])
            i = j
    return np.concatenate(pieces) if pieces else pcm


def _trim_words(pcm: np.ndarray, words: list[tuple[float, float]]) -> np.ndarray:
    if not words:
        return _tidy(pcm)
    start = max(0.0, words[0][0] - 0.04)
    end = min(len(pcm) / SR, words[-1][1] + 0.06)
    return pcm[int(start * SR) : int(end * SR)]


def _cache_path(cache: Path, key: str) -> Path:
    return cache / (hashlib.sha1(key.encode()).hexdigest()[:16] + ".wav")


def _volc_speaker(voice: dict) -> str:
    return os.environ.get("VOLC_VOICE_ID") or voice.get("speaker") or "S_HXY3ePta2"


def _volc_creds() -> dict:
    app = os.environ.get("VOLC_APPID", "")
    token = os.environ.get("VOLC_ACCESS_TOKEN") or os.environ.get("VOLC_SECRET_KEY") or ""
    if not app or not token:
        raise SystemExit(
            "火山配音缺少 VOLC_APPID 和 VOLC_ACCESS_TOKEN(旧版控制台 Access Token;"
            "只填了 VOLC_SECRET_KEY 时会当作 Access Token)。或改用 --tts edge。"
        )
    return {
        "app": app,
        "token": token,
        "resource": os.environ.get("VOLC_RESOURCE_ID") or "seed-icl-2.0",
    }


def _synth_volc(text: str, speaker: str, cache: Path) -> np.ndarray:
    import requests

    creds = _volc_creds()
    path = _cache_path(cache, f"volc|{creds['resource']}|{speaker}|{text}")
    if path.is_file():
        return _read_wav(path)
    headers = {
        "X-Api-App-Id": creds["app"],
        "X-Api-Access-Key": creds["token"],
        "X-Api-Resource-Id": creds["resource"],
        "X-Api-Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }
    body = {
        "user": {"uid": "mediapilot"},
        "req_params": {"text": text, "speaker": speaker, "audio_params": {"format": "pcm", "sample_rate": SR}},
    }
    resp = requests.post("https://openspeech.bytedance.com/api/v3/tts/unidirectional", headers=headers, json=body, timeout=120)
    if resp.status_code != 200:
        raise SystemExit(f"火山 TTS HTTP {resp.status_code}: {resp.text[:240]}")
    raw = resp.content.decode("utf-8", "replace")
    decoder, i, audio, errors = __import__("json").JSONDecoder(), 0, b"", []
    while i < len(raw):
        while i < len(raw) and raw[i].isspace():
            i += 1
        if i >= len(raw):
            break
        obj, i = decoder.raw_decode(raw, i)
        if obj.get("data"):
            audio += base64.b64decode(obj["data"])
        elif obj.get("code") not in (0, None, 20000000):
            errors.append({k: v for k, v in obj.items() if k != "data"})
    if not audio:
        raise SystemExit(f"火山 TTS 没有音频: {errors[:2]}")
    pcm = np.frombuffer(audio, dtype=np.int16).copy()
    pcm = _tidy(pcm)
    _write_wav(path, pcm)
    return pcm


async def _synth_edge(text: str, voice_name: str, rate: str, cache: Path) -> np.ndarray:
    path = _cache_path(cache, f"edge|{voice_name}|{rate}|{text}")
    if path.is_file():
        return _read_wav(path)
    import edge_tts

    last = None
    for attempt in range(3):
        try:
            comm = edge_tts.Communicate(text, voice_name, rate=rate or "+0%", boundary="WordBoundary")
            buf, words = bytearray(), []
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf += chunk["data"]
                elif chunk["type"] == "WordBoundary":
                    words.append((chunk["offset"] / 1e7, (chunk["offset"] + chunk["duration"]) / 1e7))
            pcm = _trim_words(_ffmpeg_pcm(bytes(buf)), words)
            _write_wav(path, pcm)
            return pcm
        except Exception as exc:
            last = exc
            if attempt == 2:
                raise SystemExit(f"edge-tts 失败: {last}") from exc
            await asyncio.sleep(2)
    raise SystemExit(f"edge-tts 失败: {last}")


def _assemble(project: dict, pieces_in: list[tuple[int, int, str, np.ndarray]]) -> tuple[np.ndarray, dict]:
    voice = project.get("voice") or {}
    gap_line = float(voice.get("gapLine", 0.15))
    gap_card = float(voice.get("gapCard", 0.4))
    lead = float(voice.get("lead", 0.35))
    tail = float(voice.get("tail", 1.0))
    pieces = [np.zeros(int(lead * SR), np.int16)]
    caps = []
    card_from = {}
    t = lead
    for k, (ci, li, line, pcm) in enumerate(pieces_in):
        if k > 0:
            gap = gap_card if li == 0 else gap_line
            pieces.append(np.zeros(int(gap * SR), np.int16))
            t += gap
        if li == 0:
            card_from[ci] = t - (gap_card / 2 if k > 0 else lead)
        dur = len(pcm) / SR
        caps.append({
            "startSec": round(t, 3),
            "endSec": round(t + dur, 3),
            "text": re.sub(r"[，。；：、,.;:]$", "", line),
            "card": ci,
            "line": li,
        })
        pieces.append(pcm)
        t += dur
    pieces.append(np.zeros(int(tail * SR), np.int16))
    total = t + tail
    for left, right in zip(caps, caps[1:]):
        left["endSec"] = right["startSec"]
    if caps:
        caps[-1]["endSec"] = round(caps[-1]["endSec"] + 0.5, 3)
    n = len(project["cards"])
    cards = [{
        "from": round(card_from[i] if i else 0.0, 3),
        "to": round(card_from[i + 1] if i + 1 < n else total, 3),
    } for i in range(n)]
    timeline = {"durationSec": round(total, 3), "cards": cards, "captions": caps}
    return np.concatenate(pieces), timeline


def synthesize(project: dict, public: Path, cache: Path, engine: str) -> dict:
    if not shutil_which("ffmpeg"):
        raise SystemExit("找不到 ffmpeg。macOS: brew install ffmpeg")
    voice = project.get("voice") or {}
    pron = voice.get("pronounce") or {}
    jobs = [(ci, li, line, _spoken(line, pron)) for ci, card in enumerate(project["cards"]) for li, line in enumerate(card["lines"])]
    if engine == "edge":
        name = os.environ.get("EDGE_VOICE") or voice.get("name") or "zh-CN-YunjianNeural"
        rate = os.environ.get("EDGE_RATE") or voice.get("rate") or "+0%"

        async def all_edge():
            sem = asyncio.Semaphore(4)

            async def one(text):
                async with sem:
                    return await _synth_edge(text, name, rate, cache)

            return await asyncio.gather(*[one(text) for *_, text in jobs])

        pcms = asyncio.run(all_edge())
        print(f"tts edge {name} {rate} {len(jobs)} 句")
    elif engine == "volc":
        speaker = _volc_speaker(voice)
        pcms = [_synth_volc(text, speaker, cache) for *_, text in jobs]
        print(f"tts volc {speaker} {len(jobs)} 句")
    else:
        raise SystemExit(f"未知 TTS 引擎 {engine}(用 volc 或 edge)")
    audio, timeline = _assemble(project, [(ci, li, line, pcm) for (ci, li, line, _), pcm in zip(jobs, pcms)])
    public.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "160k", str(public / "narr.mp3")],
        input=audio.tobytes(),
        capture_output=True,
    )
    if proc.returncode != 0:
        raise SystemExit("ffmpeg 写 narr.mp3 失败: " + proc.stderr.decode()[-300:])
    print(f"dur {timeline['durationSec']:.2f}s lines {len(timeline['captions'])}")
    return timeline


def shutil_which(name: str) -> str | None:
    from shutil import which
    return which(name)
