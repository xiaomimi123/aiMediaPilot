# 价格监控:对比两次抓取的价格变化,并筛出"低价+高分+有货"的书
import csv, sys
load = lambda f: {r["title"]: r for r in csv.DictReader(open(f, encoding="utf-8"))}
old, new = load(sys.argv[1]), load(sys.argv[2])
limit = float(sys.argv[3]) if len(sys.argv) > 3 else 15

changed = [(t, float(old[t]["price"]), float(r["price"])) for t, r in new.items()
           if t in old and old[t]["price"] != r["price"]]
print(f"价格变动 {len(changed)} 本")
for t, a, b in changed:
    print(f"  {'↓降价' if b < a else '↑涨价'} £{a} → £{b}  {t}")

cheap = sorted((r for r in new.values() if float(r["price"]) < limit
                and int(r["rating"]) >= 4 and r["in_stock"] == "True"), key=lambda r: float(r["price"]))
print(f"低于 £{limit}、4 星以上、有货:{len(cheap)} 本")
for r in cheap[:10]:
    print(f"  £{r['price']}  {r['rating']}星  {r['title']}")
