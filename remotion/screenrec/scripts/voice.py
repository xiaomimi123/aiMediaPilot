"""配音: python scripts/voice.py <config> [--env-file F] [--check] [--import-props props.json --import-mp3 narr.mp3]
- 火山克隆音色; 凭证只从环境变量读: VOLC_APPID / VOLC_ACCESS_TOKEN, 音色 ID 读 config.voice.speakerEnv 指向的变量(默认 VOLC_SPEAKER_ID),
  resource 读 VOLC_RESOURCE_ID(默认 seed-icl-2.0)。--env-file 只是把文件里的 KEY=VALUE 载入环境, 不打印。
- 每句去首尾静音, 句内 >maxPause 的静音压到 keepPause(只删静音不变速)。
- pronounce 只改送合成的文本(谐音), 字幕保留原文。按 speaker+文本哈希缓存 wav, 不重复计费。
- --check 用 faster-whisper 逐句转写, 打印 送/听 对照。
- --import-*: 复用已有成片的 timeline + narr.mp3(不重做配音)。
输出: <workDir>/voice/{narr.mp3,timeline.json,lines.json}"""
import json, os, re, sys, hashlib, base64, uuid, wave, subprocess, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SR = 24000
a = sys.argv[1:]; cfg = json.load(open(a[0])); V = cfg["voice"]
opt = lambda k: a[a.index(k) + 1] if k in a else None
OUT = os.path.join(ROOT, cfg["workDir"], "voice"); os.makedirs(OUT, exist_ok=True)
if opt("--import-props"):
    tl = json.load(open(opt("--import-props")))["timeline"]
    json.dump(tl, open(os.path.join(OUT, "timeline.json"), "w"), ensure_ascii=False, indent=1)
    shutil.copy(opt("--import-mp3"), os.path.join(OUT, "narr.mp3"))
    print(f"导入 timeline: {tl['durationSec']}s, {len(tl['captions'])} 行; narr.mp3 已复制"); sys.exit()
import numpy as np, requests
if opt("--env-file"):
    for l in open(opt("--env-file")):
        l = l.strip()
        if "=" in l and not l.startswith("#"): k, v = l.split("=", 1); os.environ.setdefault(k, v.strip().strip("\"'"))
need = ["VOLC_APPID", "VOLC_ACCESS_TOKEN", V.get("speakerEnv", "VOLC_SPEAKER_ID")]
miss = [k for k in need if not os.environ.get(k)]
if miss: sys.exit(f"缺环境变量: {miss}(只报名字, 不显示内容)")
CACHE = os.path.join(ROOT, cfg["workDir"], "tts_cache"); os.makedirs(CACHE, exist_ok=True)
SPK = os.environ[V.get("speakerEnv", "VOLC_SPEAKER_ID")]
def synth(text):
    f = os.path.join(CACHE, hashlib.sha1((SPK + "|" + text).encode()).hexdigest()[:16] + ".wav")
    if os.path.exists(f): return f, False
    h = {"X-Api-App-Id": os.environ["VOLC_APPID"], "X-Api-Access-Key": os.environ["VOLC_ACCESS_TOKEN"],
         "X-Api-Resource-Id": os.environ.get(V.get("resourceEnv", "VOLC_RESOURCE_ID"), "seed-icl-2.0"),
         "X-Api-Request-Id": str(uuid.uuid4()), "Content-Type": "application/json"}
    body = {"user": {"uid": "screenrec-film"}, "req_params": {"text": text, "speaker": SPK, "audio_params": {"format": "pcm", "sample_rate": SR}}}
    raw = requests.post("https://openspeech.bytedance.com/api/v3/tts/unidirectional", headers=h, json=body, timeout=120).content.decode("utf-8", "replace")
    dec, i, audio, err = json.JSONDecoder(), 0, b"", []
    while i < len(raw):
        while i < len(raw) and raw[i].isspace(): i += 1
        if i >= len(raw): break
        o, i = dec.raw_decode(raw, i)
        if o.get("data"): audio += base64.b64decode(o["data"])
        elif o.get("code") not in (0, None, 20000000): err.append(o.get("code"))
    if not audio: sys.exit(f"TTS 失败, 错误码 {err}")
    w = wave.open(f, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(audio); w.close()
    return f, True
def load(f): w = wave.open(f); return np.frombuffer(w.readframes(w.getnframes()), np.int16)
def tidy(pcm, maxgap, keep, edge=0.05):
    fr = SR // 100; n = len(pcm) // fr
    e = np.sqrt((pcm[:n * fr].astype(np.float32).reshape(n, fr) ** 2).mean(1)); voiced = e > max(250.0, e.max() * 0.03)
    idx = np.where(voiced)[0]; s, b = max(0, idx[0] - int(edge * 100)), min(n, idx[-1] + 1 + int(edge * 100))
    out, i, cut = [], s, 0.0
    while i < b:
        j = i
        while j < b and voiced[j] == voiced[i]: j += 1
        L = (j - i) / 100
        if not voiced[i] and L > maxgap: out.append(pcm[i * fr:(i + int(keep * 100)) * fr]); cut += L - keep
        else: out.append(pcm[i * fr:j * fr])
        i = j
    return np.concatenate(out), cut
gl, gc, lead, tail = V.get("gapLine", .12), V.get("gapCard", .45), V.get("lead", .15), V.get("tail", 1.2)
pieces = [np.zeros(int(lead * SR), np.int16)]; caps, lines, card_from = [], [], {}; t = lead; billed = 0; k = 0
for ci, sh in enumerate(cfg["shots"]):
    for li, line in enumerate(sh["lines"]):
        spoken = line
        for x, y in V.get("pronounce", {}).items(): spoken = spoken.replace(x, y)
        f, new = synth(spoken); billed += len(spoken) if new else 0
        seg, cut = tidy(load(f), V.get("maxPause", .5), V.get("keepPause", .4))
        if k > 0: g = gc if li == 0 else gl; pieces.append(np.zeros(int(g * SR), np.int16)); t += g
        if li == 0: card_from[ci] = t - (gc / 2 if k > 0 else lead)
        d = len(seg) / SR
        caps.append({"startSec": round(t, 3), "endSec": round(t + d, 3), "text": re.sub(r"[，。；：、,.;:]$", "", line), "card": ci, "line": li})
        lines.append({"i": k, "shown": line, "spoken": spoken, "wav": f, "dur": round(d, 2), "pauseCut": round(cut, 2)})
        pieces.append(seg); t += d; k += 1
        if li == len(sh["lines"]) - 1 and sh.get("pad"): pieces.append(np.zeros(int(sh["pad"] * SR), np.int16)); t += sh["pad"]
pieces.append(np.zeros(int(tail * SR), np.int16)); total = t + tail
for x, y in zip(caps, caps[1:]): x["endSec"] = y["startSec"]
caps[-1]["endSec"] = round(caps[-1]["endSec"] + 0.5, 3)
n = len(cfg["shots"]); cards = [{"from": round(card_from[i] if i else 0.0, 3), "to": round(card_from[i + 1] if i + 1 < n else total, 3)} for i in range(n)]
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "192k", os.path.join(OUT, "narr.mp3")], input=np.concatenate(pieces).tobytes(), check=True)
json.dump({"durationSec": round(total, 3), "cards": cards, "captions": caps}, open(os.path.join(OUT, "timeline.json"), "w"), ensure_ascii=False, indent=1)
json.dump(lines, open(os.path.join(OUT, "lines.json"), "w"), ensure_ascii=False, indent=1)
print(f"时长 {total:.2f}s, {len(caps)} 行, 本次新计费字符≈{billed}")
for i, c in enumerate(cards): print(f"镜头 {i+1}: {c['from']:.2f}-{c['to']:.2f} ({c['to']-c['from']:.1f}s) {cfg['shots'][i]['kind']}")
if "--check" in a:
    from faster_whisper import WhisperModel
    m = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    for x in lines:
        s = load(x["wav"]).astype(np.float32) / 32768; s = np.interp(np.arange(0, len(s), 1.5), np.arange(len(s)), s).astype(np.float32)
        r = "".join(z.text for z in m.transcribe(s, language="zh", initial_prompt="以下是普通话,含英文技术词。")[0])
        print(f"{x['i']:02d} 送: {x['spoken']}\n   听: {r}")
