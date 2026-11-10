"""用 Playwright 打开 screens 里的页面,整页截图并记下标注坐标。"""
import os
import re
import time
from pathlib import Path

def _find(page, spec):
    loc = page.locator(spec["css"])
    if "hasText" in spec:
        loc = loc.filter(has_text=re.compile(spec["hasText"]))
    pending = spec.get("nth", 0)
    for i in range(loc.count()):
        box = loc.nth(i).bounding_box()
        if not box or box["width"] <= 2 or box["height"] <= 2 or box["x"] < spec.get("minX", -1e9):
            continue
        if pending == 0:
            return box
        pending -= 1
    return None


def capture(project: dict, public: Path) -> dict:
    from playwright.sync_api import sync_playwright

    screens = project.get("screens") or []
    out_dir = public / "screens"
    out_dir.mkdir(parents=True, exist_ok=True)
    chrome = os.environ.get("CHROME") or None
    launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
    if chrome:
        launch["executable_path"] = chrome
    result = {}
    try:
        pw = sync_playwright().start()
    except Exception as exc:
        raise SystemExit(f"Playwright 无法启动:{exc}\n先 pip install -r pipeline/requirements.txt && python -m playwright install chromium") from exc
    try:
        try:
            browser = pw.chromium.launch(**launch)
        except Exception as exc:
            raise SystemExit(
                "Chromium 启动失败。运行 python -m playwright install chromium,或设置 CHROME 为浏览器路径。\n" + str(exc)
            ) from exc
        pages = {}
        for screen in screens:
            vw, vh = screen.get("viewport", [1280, 720])
            if "from" in screen:
                page = pages[screen["from"]]
                page.set_viewport_size({"width": vw, "height": vh})
                spec = screen["click"]
                loc = page.locator(spec["css"])
                if "hasText" in spec:
                    loc = loc.filter(has_text=re.compile(spec["hasText"]))
                loc.first.click()
                page.wait_for_load_state("networkidle", timeout=60000)
            else:
                page = browser.new_page(viewport={"width": vw, "height": vh}, device_scale_factor=2, locale="en-US")
                started = time.time()
                page.goto(screen["url"], wait_until="networkidle", timeout=60000)
                print(f"{screen['id']}: loaded in {time.time() - started:.1f}s")
            time.sleep(1.0)
            for css in screen.get("hide", []):
                page.add_style_tag(content=f"{css}{{display:none!important}}")
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.4)
            for _ in range(2):
                height = min(page.evaluate("document.documentElement.scrollHeight"), screen.get("maxHeight", 6000))
                page.set_viewport_size({"width": vw, "height": max(vh, int(height))})
                time.sleep(0.3)
            height = min(page.evaluate("document.documentElement.scrollHeight"), screen.get("maxHeight", 6000))
            top = screen.get("clipTop", 0)
            if top:
                height = min(page.evaluate("document.documentElement.scrollHeight"), top + screen.get("maxHeight", 6000))
            image = f"screens/{screen['id']}.jpg"
            page.screenshot(
                path=str(out_dir / f"{screen['id']}.jpg"),
                clip={"x": 0, "y": top, "width": vw, "height": height - top},
                type="jpeg",
                quality=88,
            )
            sx, sy = page.evaluate("[window.scrollX, window.scrollY]")
            marks = {}
            for name, spec in (screen.get("marks") or {}).items():
                box = _find(page, spec)
                if not box:
                    print(f"  !! mark {name} 没找到: {spec}")
                    continue
                box = {**box, "x": box["x"] + sx, "y": box["y"] + sy - top}
                marks[name] = {k: round(box[k], 1) for k in ("x", "y", "width", "height")}
            page.set_viewport_size({"width": vw, "height": vh})
            result[screen["id"]] = {
                "url": page.url,
                "title": page.title(),
                "width": vw,
                "height": height - top,
                "image": image,
                "marks": marks,
                "capturedAt": time.strftime("%Y-%m-%d %H:%M"),
            }
            print(f"  {screen['id']} {page.url} {vw}x{height - top} marks={list(marks)}")
            pages[screen["id"]] = page
        browser.close()
    finally:
        pw.stop()
    return result
