"""复制一份抓取结果,改两本书的价格,用来演示涨跌。文件名必须带 SIMULATED。"""
import csv
import sys

src, dst = sys.argv[1], sys.argv[2]
if "SIMULATED" not in dst:
    raise SystemExit("输出文件名要包含 SIMULATED,避免和真实抓取混在一起")
with open(src, encoding="utf-8", newline="") as f:
    rows = list(csv.DictReader(f))
    fields = list(rows[0].keys()) if rows else ["title", "price", "rating", "in_stock"]
changed = 0
for row in rows:
    if row["title"] == "A Light in the Attic":
        row["price"] = "55.0"
        changed += 1
    elif row["title"] == "Sharp Objects":
        row["price"] = "45.0"
        changed += 1
with open(dst, "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(f"wrote {dst} (SIMULATED, edited {changed} prices)")
