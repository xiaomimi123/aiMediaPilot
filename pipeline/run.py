#!/usr/bin/env python3
"""每日开源横屏一条命令:仓库数据 → 页面截图 → 终端录制 → 配音 → 合成 → 静帧 → 成片。

  python3 pipeline/run.py pipeline/projects/scrapling.json
  python3 pipeline/run.py pipeline/projects/scrapling.json --tts edge
  python3 pipeline/run.py pipeline/projects/scrapling.json --force tts --only tts,merge,stills,render
"""
import argparse
import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from lib.capture import capture  # noqa: E402
from lib.merge import build_props, install_fonts  # noqa: E402
from lib.stats import fetch  # noqa: E402
from lib.termrec import run_command  # noqa: E402
from lib.tts import synthesize  # noqa: E402
from lib.util import STEPS, Cache, fail, load_env, read_json, sha, write_json  # noqa: E402

STATS_TTL = 12 * 3600


def parse_set(value: str | None) -> set[str]:
    if not value:
        return set()
    names = {part.strip() for part in value.split(",") if part.strip()}
    bad = names - set(STEPS) - {"all"}
    if bad:
        fail("未知步骤: " + ",".join(sorted(bad)) + "。可选 " + ",".join(STEPS))
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description="每日开源横屏一条命令出片")
    parser.add_argument("project", help="项目 JSON(数据 + 旁白 + 可选实测命令)")
    parser.add_argument("--tts", choices=["volc", "edge"], help="覆盖 TTS_ENGINE,默认火山克隆音色")
    parser.add_argument("--only", help="只跑这些步骤,逗号分隔")
    parser.add_argument("--skip", help="跳过这些步骤,逗号分隔")
    parser.add_argument("--force", nargs="?", const="all", default="", help="忽略缓存。可写步骤名,不写则全部重跑")
    parser.add_argument("--stills", default="5,12,30", help="静帧秒数,默认 5,12,30")
    parser.add_argument("--out", help="成片路径,默认 build/<slug>/film.mp4")
    parser.add_argument("--max-sec", type=float, help="成片只渲染前 N 秒")
    args = parser.parse_args()
    load_env()

    project_path = Path(args.project).resolve()
    if not project_path.is_file():
        fail(f"找不到项目 {project_path}")
    project = read_json(project_path)
    slug = project.get("slug")
    if not slug or not project.get("cards"):
        fail("项目 JSON 需要 slug 和 cards")
    build = ROOT / "build" / slug
    build.mkdir(parents=True, exist_ok=True)
    cache = Cache(build / "cache.json")
    cached_stats = cache.data.get("stats") or {}
    if cached_stats.get("key") == project.get("repo") and cached_stats.get("stats"):
        project["stats"] = cached_stats["stats"]
        project["asOf"] = cached_stats.get("asOf") or project.get("asOf")
    force = parse_set(args.force)
    only = parse_set(args.only) if args.only else None
    skip = parse_set(args.skip)

    def enabled(step: str) -> bool:
        if step in skip:
            return False
        if only is not None and step not in only:
            return False
        return True

    if enabled("stats"):
        project = step_stats(project, cache, force)
    if enabled("capture"):
        step_capture(project, build, cache, force)
    if enabled("term"):
        step_term(project, project_path, build, cache, force)
    if enabled("tts"):
        step_tts(project, build, cache, force, args.tts)
    if enabled("merge"):
        step_merge(project, project_path, build)
    out = Path(args.out).resolve() if args.out else build / "film.mp4"
    if enabled("stills") or enabled("render"):
        step_render(build, cache, force, enabled("stills"), enabled("render"), args.stills, out, args.max_sec)
    print(f"完成 {build}")


def step_stats(project: dict, cache: Cache, force: set[str]) -> dict:
    repo = project.get("repo") or ""
    if "/" not in repo or repo.startswith("owner/"):
        print("stats 跳过(没有 GitHub 仓库)")
        return project
    entry = cache.data.get("stats") or {}
    fresh = (
        "all" not in force
        and "stats" not in force
        and entry.get("key") == repo
        and entry.get("stats")
        and time.time() - float(entry.get("fetchedAt") or 0) < STATS_TTL
    )
    if fresh:
        project["stats"] = entry["stats"]
        project["asOf"] = entry["asOf"]
        print(f"stats 缓存命中 ★{entry['stats']['stars']}")
        return project
    got = fetch(repo, entry if entry.get("key") == repo else None, "stats" in force or "all" in force)
    project["stats"] = got["stats"]
    project["asOf"] = got["asOf"]
    cache.put("stats", repo, {"fetchedAt": time.time(), "etag": got.get("etag"), "stats": got["stats"], "asOf": got["asOf"]})
    return project


def step_capture(project: dict, build: Path, cache: Cache, force: set[str]) -> None:
    screens = project.get("screens") or []
    key = sha(screens)
    outs = [build / "screens.json", *[(build / "public" / "screens" / f"{s['id']}.jpg") for s in screens]]
    if screens and cache.fresh("capture", key, outs, force):
        print("capture 缓存命中")
        return
    if not screens:
        print("capture 跳过(没有页面)")
        write_json(build / "screens.json", {})
        cache.put("capture", key)
        return
    print(f"capture {len(screens)} 页")
    result = capture(project, build / "public")
    write_json(build / "screens.json", result)
    cache.put("capture", key)


def step_term(project: dict, project_path: Path, build: Path, cache: Cache, force: set[str]) -> None:
    commands = project.get("commands") or []
    if not commands:
        print("term 跳过(没有实测命令)")
        return
    term_cache = cache.data.setdefault("term", {})
    force_term = "all" in force or "term" in force
    for spec in commands:
        key = sha({k: spec.get(k) for k in ("id", "run", "then", "cwd", "venv", "allowFail", "record", "outputs", "timeout")})
        cwd = (project_path.parent / spec.get("cwd", ".")).resolve()
        rec_path = build / "rec" / f"{spec['id']}.json"
        stamp = build / "stamps" / spec["id"]
        outputs = [stamp]
        if spec.get("record", True):
            outputs.append(rec_path)
        outputs += [(cwd / rel).resolve() for rel in spec.get("outputs") or []]
        saved = term_cache.get(spec["id"]) or {}
        if not force_term and saved.get("key") == key and all(p.is_file() and p.stat().st_size > 0 for p in outputs):
            print(f"term {spec['id']} 缓存命中")
            continue
        print(f"term {spec['id']}: {spec['run']}")
        venv = build / "venvs" / spec["venv"] if spec.get("venv") else None
        recorded, _code = run_command(spec, cwd, venv)
        if recorded is not None:
            write_json(rec_path, recorded)
            print(f"  {recorded['dur']}s {len(recorded['frames'])} 帧")
        for rel in spec.get("outputs") or []:
            if not (cwd / rel).is_file():
                fail(f"命令 {spec['id']} 没有产出 {rel}")
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(key + "\n")
        term_cache[spec["id"]] = {"key": key}
        cache.save()


def engine_of(project: dict, override: str | None) -> str:
    if override:
        return override
    env = os.environ.get("TTS_ENGINE")
    if env:
        return env
    return (project.get("voice") or {}).get("engine") or "volc"


def step_tts(project: dict, build: Path, cache: Cache, force: set[str], override: str | None) -> None:
    engine = engine_of(project, override)
    voice = project.get("voice") or {}
    key = sha({
        "engine": engine,
        "lines": [line for card in project["cards"] for line in card["lines"]],
        "pronounce": voice.get("pronounce") or {},
        "gapLine": voice.get("gapLine"),
        "gapCard": voice.get("gapCard"),
        "lead": voice.get("lead"),
        "tail": voice.get("tail"),
        "speaker": os.environ.get("VOLC_VOICE_ID") or voice.get("speaker"),
        "resource": os.environ.get("VOLC_RESOURCE_ID"),
        "edgeVoice": os.environ.get("EDGE_VOICE") or voice.get("name"),
        "edgeRate": os.environ.get("EDGE_RATE") or voice.get("rate"),
    })
    outs = [build / "public" / "narr.mp3", build / "timeline.json"]
    if cache.fresh("tts", key, outs, force):
        print(f"tts 缓存命中 ({engine})")
        return
    for card in project["cards"]:
        if not card.get("lines"):
            fail(f"卡片 {card.get('kind')} 缺少 lines")
    print(f"tts {engine}")
    timeline = synthesize(project, build / "public", build / "tts", engine)
    write_json(build / "timeline.json", timeline)
    cache.put("tts", key, {"engine": engine})


def _needed_recs(project: dict) -> set[str]:
    needed = set()
    for card in project["cards"]:
        for session in card.get("sessions") or []:
            if session.get("rec"):
                needed.add(session["rec"])
        if (card.get("session") or {}).get("rec"):
            needed.add(card["session"]["rec"])
    return needed


def step_merge(project: dict, project_path: Path, build: Path) -> None:
    screens_path = build / "screens.json"
    timeline_path = build / "timeline.json"
    if not timeline_path.is_file():
        fail("没有旁白时间轴,先跑 tts")
    screens = read_json(screens_path) if screens_path.is_file() else {}
    recs = {}
    rec_dir = build / "rec"
    if rec_dir.is_dir():
        for path in sorted(rec_dir.glob("*.json")):
            recs[path.stem] = read_json(path)
    missing = _needed_recs(project) - set(recs)
    if missing:
        fail("缺少终端回放: " + ", ".join(sorted(missing)))
    build_props(project, project_path, build, screens, recs, read_json(timeline_path))
    print("merge props.json")


def step_render(build: Path, cache: Cache, force: set[str], do_stills: bool, do_render: bool, stills: str, out: Path, max_sec: float | None) -> None:
    props = build / "props.json"
    if not props.is_file():
        fail("没有 props.json,先跑 merge")
    if not (ROOT / "node_modules" / "remotion").is_dir():
        fail("先运行 npm install --prefix pipeline")
    install_fonts(build / "public")
    digest = hashlib.sha256(props.read_bytes()).hexdigest()[:16]
    cmd = ["node", str(ROOT / "render.mjs"), str(build)]
    ran = False
    if do_stills:
        outs = [build / "stills" / f"{part.strip()}.jpg" for part in stills.split(",") if part.strip()]
        if cache.fresh("stills", digest + ":" + stills, outs, force):
            print("stills 缓存命中")
        else:
            cmd += ["--stills", stills]
            ran = True
    if do_render:
        key = f"{digest}:{max_sec}:{out}"
        if cache.fresh("render", key, [out], force):
            print(f"render 缓存命中 {out}")
        else:
            cmd += ["--out", str(out)]
            if max_sec:
                cmd += ["--max-sec", str(max_sec)]
            ran = True
    if not ran:
        return
    print("render", " ".join(cmd[1:]))
    subprocess.run(cmd, cwd=str(ROOT), check=True)
    if do_stills and "--stills" in cmd:
        cache.put("stills", digest + ":" + stills)
    if do_render and "--out" in cmd:
        cache.put("render", f"{digest}:{max_sec}:{out}")


if __name__ == "__main__":
    main()
