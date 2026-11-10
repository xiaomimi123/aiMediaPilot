"""把项目、截图、终端回放、CSV、代码和旁白时间轴合成 props.json。"""
import csv
import shutil
from pathlib import Path

from .util import ROOT, write_json


def _rows(path: Path, limit: int | None) -> list[list[str]]:
    with open(path, encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        wanted = [name for name in ("title", "price", "rating", "in_stock") if name in fields] or list(fields)
        rows = [[row[name] for name in wanted] for row in reader]
    if limit:
        rows = rows[:limit]
    return rows


def _summarize(name: str, path: Path) -> None:
    with open(path, encoding="utf-8", newline="") as handle:
        data = list(csv.DictReader(handle))
    if not data or "price" not in data[0]:
        print(f"  csv {name}: {len(data)} 行")
        return
    prices = [float(row["price"]) for row in data]
    cheap = sum(1 for row in data if float(row["price"]) < 15 and int(float(row["rating"])) >= 4 and row.get("in_stock") in {"True", "true", "有货"})
    print(f"  csv {name}: {len(data)} 行 £{min(prices):.2f}–£{max(prices):.2f} 均价 £{sum(prices)/len(prices):.2f} 低价高分有货 {cheap}")


def install_fonts(public: Path) -> None:
    dest = public / "fonts"
    dest.mkdir(parents=True, exist_ok=True)
    for font in (ROOT / "fonts").glob("*.woff2"):
        target = dest / font.name
        if not target.is_file() or target.stat().st_size != font.stat().st_size:
            shutil.copy2(font, target)


def build_props(project: dict, project_path: Path, build: Path, screens: dict, recs: dict, timeline: dict) -> dict:
    public = build / "public"
    public.mkdir(parents=True, exist_ok=True)
    install_fonts(public)
    for asset in project.get("assets") or []:
        src = (project_path.parent / asset).resolve()
        if not src.is_file():
            raise SystemExit(f"找不到素材 {asset}")
        shutil.copy2(src, public / src.name)
    csv_out = {}
    for name, spec in (project.get("datasets") or {}).items():
        path = (project_path.parent / spec["path"]).resolve()
        if not path.is_file():
            raise SystemExit(f"找不到数据集 {name}: {path}")
        csv_out[name] = _rows(path, spec.get("limit"))
        _summarize(name, path)
    cards = []
    for card in project["cards"]:
        card = dict(card)
        if card.get("kind") == "code":
            rel = card.get("path") or card.get("file")
            path = (project_path.parent / rel).resolve()
            if not path.is_file():
                raise SystemExit(f"找不到代码文件 {rel}")
            card["_code"] = path.read_text(encoding="utf-8").rstrip("\n").split("\n")
            card["file"] = card.get("file") or path.name
        cards.append(card)
    props = {
        "project": {**project, "cards": cards},
        "screens": screens,
        "recs": recs,
        "csv": csv_out,
        "timeline": timeline,
    }
    write_json(build / "props.json", props)
    return props
