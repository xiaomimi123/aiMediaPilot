"""校验: python scripts/verify.py <config> <film.mp4> [--no-asr]
1) ffprobe: 时长(对比 verify.targetSec)、分辨率、帧率、音轨
2) 按 verify.keyTimes 抽帧 → <workDir>/verify/sheet.jpg(人工看: 字幕不遮挡/角标每帧在/DEV 不可见/无禁用词画面)
3) faster-whisper 转写整片, 和 config 每句口播做字符相似度, 列出疑似漏读; 同时检查配置文字里有无 verify.forbid 词"""
import json, os, sys, subprocess, difflib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(sys.argv[1])); F = sys.argv[2]; OUT = os.path.join(ROOT, cfg["workDir"], "verify"); os.makedirs(OUT, exist_ok=True)
pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels", "-of", "json", F], capture_output=True, text=True).stdout)
dur = float(pr["format"]["duration"]); v = [s for s in pr["streams"] if s["codec_type"] == "video"][0]; au = [s for s in pr["streams"] if s["codec_type"] == "audio"]
lo, hi = cfg["verify"].get("targetSec", [0, 1e9])
print(f"时长 {dur:.2f}s {'OK' if lo <= dur <= hi else '超出 ' + str([lo, hi])} | {v['width']}x{v['height']} {v['r_frame_rate']} {v['codec_name']} | 音轨 {'有 ' + au[0]['codec_name'] + ' ' + au[0]['sample_rate'] + 'Hz' if au else '无!'}")
from PIL import Image
ts = cfg["verify"]["keyTimes"]; ims = []
for t in ts:
    p = os.path.join(OUT, f"f_{t}.png"); subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(min(t, dur - 0.1)), "-i", F, "-frames:v", "1", p], check=True); ims.append(p)
Wd, Ht = 640, 360; cols = 3; sheet = Image.new("RGB", (Wd * cols, Ht * ((len(ims) + cols - 1) // cols)))
for i, p in enumerate(ims): sheet.paste(Image.open(p).convert("RGB").resize((Wd, Ht)), ((i % cols) * Wd, (i // cols) * Ht))
sheet.save(os.path.join(OUT, "sheet.jpg"), quality=85); print("抽帧拼图:", os.path.join(OUT, "sheet.jpg"), "(需人工看)")
txt = json.dumps(cfg["shots"], ensure_ascii=False) + cfg.get("badge", "")
bad = [w for w in cfg["verify"].get("forbid", []) if w in txt]; print("禁用词:", bad or "无")
if "--no-asr" in sys.argv: sys.exit()
import wave, numpy as np
from faster_whisper import WhisperModel
wav = os.path.join(OUT, "a.wav"); subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", F, "-ar", "16000", "-ac", "1", wav], check=True)
w = wave.open(wav); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768  # 直接传数组, 避开新版 av 的参数不兼容
m = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
heard = "".join(s.text for s in m.transcribe(a, language="zh", initial_prompt="以下是普通话,含英文技术词。")[0])
open(os.path.join(OUT, "asr.txt"), "w").write(heard); print("转写:", heard)
norm = lambda s: "".join(ch for ch in s.lower() if ch.isalnum())
H = norm(heard)
for sh in cfg["shots"]:
    for ln in sh["lines"]:
        L = norm(ln); best = max((difflib.SequenceMatcher(None, L, H[i:i + len(L)]).ratio() for i in range(0, max(1, len(H) - len(L) + 1))), default=0)
        print(f"  {'OK ' if best >= 0.6 else '查?'} {best:.2f} {ln}")
