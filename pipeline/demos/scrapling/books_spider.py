# 抓 books.toscrape.com(爬虫练习站)全站图书:书名/价格/评分/库存 → CSV + JSON
import logging, sys
from scrapling.spiders import Spider, Response
STARS = {"One": 1, "Two": 2, "Three": 3, "Four": 4, "Five": 5}

class Books(Spider):
    name, start_urls = "books", ["https://books.toscrape.com/"]
    concurrent_requests, robots_txt_obey = 5, True   # 限并发 + 遵守 robots.txt
    logging_level = logging.WARNING                   # 只看结果,不刷日志

    async def parse(self, response: Response):
        for b in response.css("article.product_pod"):
            yield {"title": b.css("h3 a::attr(title)").get(),
                   "price": float(b.css(".price_color::text").get().replace("£", "").replace("Â", "")),
                   "rating": STARS[b.css("p.star-rating::attr(class)").get().split()[-1]],
                   "in_stock": "In stock" in "".join(b.css(".availability::text").getall())}
        if nxt := response.css(".next a"):
            yield response.follow(nxt[0].attrib["href"])

out = sys.argv[1] if len(sys.argv) > 1 else "books"
r = Books().start()
r.items.to_csv(f"{out}.csv"); r.items.to_json(f"{out}.json")
print(f"抓到 {len(r.items)} 本书,{r.stats.requests_count} 个页面,用时 {r.stats.elapsed_seconds:.1f} 秒 → {out}.csv / {out}.json")
