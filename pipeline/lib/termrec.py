"""用 Python pty 录终端,再用 pyte 回放成逐时刻屏幕。

macOS 和 Linux 的 script(1) 时间戳格式不一样,所以这里不调用 script。
"""
import fcntl
import os
import select
import shutil
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

import pyte

from .util import scrub_env

COLS = 100
PTY_ROWS = 30
REPLAY_ROWS = 400


def _winsize(fd: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", PTY_ROWS, COLS, 0, 0))


def _read_master(master: int, proc: subprocess.Popen, timeout: float) -> tuple[list[tuple[float, bytes]], int]:
    chunks: list[tuple[float, bytes]] = []
    start = time.monotonic()
    last = start

    def take(data: bytes) -> None:
        nonlocal last
        if not data:
            return
        now = time.monotonic()
        chunks.append((now - last, data))
        last = now

    while True:
        if time.monotonic() - start > timeout:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                proc.kill()
            take(b"\r\n[pipeline] timeout\r\n")
            break
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            take(data)
            continue
        if proc.poll() is None:
            continue
        while True:
            ready, _, _ = select.select([master], [], [], 0.05)
            if not ready:
                break
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data:
                break
            take(data)
        break
    proc.wait(timeout=5)
    return chunks, proc.returncode if proc.returncode is not None else 1


def record(script: str, cwd: Path, timeout: float) -> tuple[list[tuple[float, bytes]], int]:
    master, slave = os.openpty()
    _winsize(slave)
    proc = subprocess.Popen(
        ["bash", "--noprofile", "--norc", "-c", script],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=str(cwd),
        env=scrub_env(),
        start_new_session=True,
    )
    os.close(slave)
    try:
        return _read_master(master, proc, timeout)
    finally:
        os.close(master)


def _snap(screen: pyte.Screen, t: float) -> dict:
    lines = [screen.display[i].rstrip() for i in range(screen.cursor.y + 1)]
    while lines and not lines[-1]:
        lines.pop()
    return {"t": round(t, 3), "lines": lines}


def replay(chunks: list[tuple[float, bytes]]) -> dict:
    screen = pyte.Screen(COLS, REPLAY_ROWS)
    stream = pyte.ByteStream(screen)
    t = 0.0
    frames = []
    for dt, chunk in chunks:
        t += dt
        stream.feed(chunk)
        frames.append(_snap(screen, t))
    if not frames:
        frames.append(_snap(screen, 0))
    return {"dur": round(t, 3), "cols": COLS, "rows": PTY_ROWS, "frames": frames}


def _bootstrap_pip(py: Path) -> None:
    if (py.parent / "pip").is_file():
        return
    proc = subprocess.run([str(py), "-m", "ensurepip", "--upgrade"], capture_output=True, text=True)
    if (py.parent / "pip").is_file():
        return
    import urllib.request
    script = path_parent_get_pip(py)
    urllib.request.urlretrieve("https://bootstrap.pypa.io/get-pip.py", script)
    boot = subprocess.run([str(py), str(script)], capture_output=True, text=True)
    if boot.returncode != 0 or not (py.parent / "pip").is_file():
        detail = (proc.stderr or "")[-200:] + "\n" + (boot.stderr or "")[-300:]
        raise SystemExit("venv 里没有 pip。macOS 用 python.org 的 Python 3.13;Debian 需要 python3-venv。\n" + detail)


def path_parent_get_pip(py: Path) -> str:
    return str(py.parent.parent / "get-pip.py")


def ensure_venv(path: Path) -> None:
    py = path / "bin" / "python"
    if py.is_file() and (path / "bin" / "pip").is_file():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if not py.is_file():
        proc = subprocess.run([sys.executable, "-m", "venv", str(path)], capture_output=True, text=True)
        if proc.returncode != 0:
            if path.exists():
                shutil.rmtree(path)
            subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(path)], check=True)
    _bootstrap_pip(py)


def run_command(spec: dict, cwd: Path, venv: Path | None) -> tuple[dict | None, int]:
    # venv 里的 python 可用。没有 venv 时,macOS / Linux 往往只有 python3。
    prefix = 'if ! command -v python >/dev/null 2>&1; then python() { python3 "$@"; }; fi\n'
    if venv:
        ensure_venv(venv)
        prefix = f'source "{venv}/bin/activate"\n' + prefix
    timeout = float(spec.get("timeout", 180))
    chunks, code = record(prefix + spec["run"], cwd, timeout)
    if code != 0 and not spec.get("allowFail"):
        tail = b"".join(c for _, c in chunks[-6:]).decode("utf-8", "replace")[-500:]
        raise SystemExit(f"命令 {spec['id']} 退出码 {code}\n{tail}")
    if code == 0 or spec.get("allowFail"):
        for extra in spec.get("then") or []:
            chunks.append((0.2, f"$ {extra}\r\n".encode()))
            more, code = record(prefix + extra, cwd, timeout)
            chunks.extend(more)
            if code != 0 and not spec.get("allowFail"):
                tail = b"".join(c for _, c in more[-6:]).decode("utf-8", "replace")[-500:]
                raise SystemExit(f"命令 {spec['id']} 的后续步骤退出码 {code}: {extra}\n{tail}")
    recorded = None if spec.get("record") is False else replay(chunks)
    return recorded, code
