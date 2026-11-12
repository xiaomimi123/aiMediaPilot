"""生成 props: python scripts/build.py <config>
输入: config + <workDir>/voice/timeline.json + <workDir>/voice/narr.mp3 + config.assets 列出的素材
输出: <workDir>/build/props.json 和 build/public/(narr.mp3 + 素材)
出处/采集时间只写在 config.sources, Film 里用 {key} 引用 —— 重跑 voice/build 都不会丢。
若旧 props.json 里有 "manual" 字段(手工补的), 原样保留。"""
import json, os, sys, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(sys.argv[1])); W = os.path.join(ROOT, cfg["workDir"]); B = os.path.join(W, "build"); P = os.path.join(B, "public")
tl = json.load(open(os.path.join(W, "voice", "timeline.json")))
if len(tl["cards"]) != len(cfg["shots"]): sys.exit(f"镜头数不一致: timeline {len(tl['cards'])} vs config {len(cfg['shots'])}, 先重跑 voice")
os.makedirs(P, exist_ok=True); shutil.copy(os.path.join(W, "voice", "narr.mp3"), os.path.join(P, "narr.mp3"))
miss = []
for dst, src in cfg.get("assets", {}).items():
    s = os.path.join(W, src)
    if not os.path.exists(s): miss.append(src); continue
    os.makedirs(os.path.dirname(os.path.join(P, dst)), exist_ok=True); shutil.copy(s, os.path.join(P, dst))
if miss: sys.exit(f"缺素材: {miss}")
old = os.path.join(B, "props.json"); manual = json.load(open(old)).get("manual") if os.path.exists(old) else None
props = {"project": cfg, "timeline": tl, **({"manual": manual} if manual else {})}
json.dump(props, open(old, "w"), ensure_ascii=False, indent=1)
empty = [k for k, v in cfg.get("sources", {}).items() if not v]
print(f"props.json 写好: {tl['durationSec']}s, {len(cfg['shots'])} 镜" + (f"; 注意 sources 未填: {empty}" if empty else ""))
