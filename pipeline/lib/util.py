"""路径、JSON 和缓存键。不含密钥。"""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
STEPS = ["stats", "capture", "term", "tts", "merge", "stills", "render"]


def fail(msg: str) -> None:
    raise SystemExit(msg)


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def sha(obj) -> str:
    blob = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def load_env() -> None:
    for path in (REPO / ".env", ROOT / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def scrub_env(base: dict | None = None) -> dict:
    """子进程不继承配音和仓库令牌,避免录屏或报错把密钥打出来。"""
    env = dict(base or os.environ)
    for key in list(env):
        if key.startswith("VOLC_") or key in {"GITHUB_TOKEN", "GH_TOKEN", "ENCRYPTION_KEY", "DATABASE_URL", "DB_PASSWORD", "DEEPSEEK_API_KEY", "OPENAI_API_KEY"}:
            env.pop(key, None)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONUTF8"] = "1"
    env["PIP_PROGRESS_BAR"] = "off"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["TERM"] = "xterm-256color"
    lang = env.get("LANG", "")
    if "UTF-8" not in lang.upper() and "UTF8" not in lang.upper():
        env["LANG"] = "C.UTF-8"
        env["LC_ALL"] = "C.UTF-8"
    return env


class Cache:
    def __init__(self, path: Path):
        self.path = path
        self.data = read_json(path) if path.is_file() else {}

    def save(self) -> None:
        write_json(self.path, self.data)

    def fresh(self, step: str, key: str, outputs: list[Path], force: set[str]) -> bool:
        if "all" in force or step in force:
            return False
        entry = self.data.get(step) or {}
        if entry.get("key") != key:
            return False
        return all(p.is_file() and p.stat().st_size > 0 for p in outputs)

    def put(self, step: str, key: str, extra: dict | None = None) -> None:
        self.data[step] = {"key": key, **(extra or {})}
        self.save()
