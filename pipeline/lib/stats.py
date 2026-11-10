"""从 GitHub API 取 star / fork / 最近推送 / 协议,写进本次构建用的项目数据。"""
import os
import time
import requests

def fetch(repo: str, previous: dict | None, force: bool) -> dict:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "mediapilot-pipeline",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    etag = None if force or not previous else previous.get("etag")
    if etag:
        headers["If-None-Match"] = etag
    url = f"https://api.github.com/repos/{repo}"
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code == 304 and previous:
        print(f"stats {repo} 未变化")
        return previous
    if resp.status_code != 200:
        if previous and not force:
            print(f"stats GitHub API {resp.status_code},用缓存")
            return previous
        body = resp.text[:200].replace("\n", " ")
        raise SystemExit(f"GitHub API {resp.status_code} {url} {body}。可设置 GITHUB_TOKEN 提高额度。")
    data = resp.json()
    lic = (data.get("license") or {}).get("spdx_id") or "未标明"
    if lic == "NOASSERTION":
        lic = "未标明"
    stats = {
        "stars": data.get("stargazers_count") or 0,
        "forks": data.get("forks_count") or 0,
        "updated": (data.get("pushed_at") or "")[:10],
        "updatedLabel": "最近推送",
        "license": lic,
        "language": data.get("language") or "",
    }
    as_of = time.strftime("%Y-%m-%d %H:%M") + "(本地时间,GitHub API)"
    print(f"stats {repo} ★{stats['stars']} fork {stats['forks']} {stats['updated']} {stats['license']}")
    return {"etag": resp.headers.get("ETag"), "fetchedAt": time.time(), "stats": stats, "asOf": as_of}
