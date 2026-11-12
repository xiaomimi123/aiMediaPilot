"""清理清单: python scripts/cleanup.py <config>      默认只列出, 不删除、不杀进程
列出 config.cleanup.dirs 的大小、匹配 config.cleanup.processes 的进程, 并打印建议命令(人工确认后再执行)。"""
import json, os, sys, subprocess
cfg = json.load(open(sys.argv[1])); C = cfg.get("cleanup", {})
print("== 目录 ==")
for d in C.get("dirs", []):
    sz = subprocess.run(["du", "-sh", d], capture_output=True, text=True).stdout.split("\t")[0] if os.path.exists(d) else "不存在"
    print(f"  {sz:>6}  {d}")
print("== 进程 ==")
for pat in C.get("processes", []):
    out = subprocess.run(["pgrep", "-af", pat], capture_output=True, text=True).stdout.strip().splitlines()
    out = [l for l in out if "cleanup.py" not in l and "pgrep" not in l]
    print(f"  [{pat}]", "无" if not out else ""); [print("    " + l[:120]) for l in out]
print("== 保留(不要删) ==", *C.get("keep", []), sep="\n  ")
print("== 建议命令(确认后手动执行) ==")
for pat in C.get("processes", []): print(f"  pkill -f '{pat}'")
for d in C.get("dirs", []): print(f"  rm -rf '{d}'")
