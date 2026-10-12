"""Write article pages from _data/articles/<article>/<lang>.yml.

Each article is listed in ARTICLES with its URL slug and the directory category its
live table and web player link use. Languages without a translation are skipped.
"""

from datetime import date
from pathlib import Path

import yaml

SITE = Path(__file__).resolve().parent.parent
ARTICLES = {
    "tv-shopping": {"slug": "tv-shopping-product-research", "category": "shop"},
}

config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
for article, meta in ARTICLES.items():
    for lang in config["languages"]:
        source = SITE / "_data/articles" / article / f"{lang}.yml"
        if not source.exists():
            continue
        a = yaml.safe_load(source.read_text(encoding="utf-8"))
        folder = SITE / ("articles" if lang == config["default_lang"] else f"{lang}/articles") / meta["slug"]
        folder.mkdir(parents=True, exist_ok=True)
        fields = {
            "layout": "article", "lang": lang, "ref": f"article-{article}", "path_key": f"articles/{meta['slug']}/",
            "article": article, "category": meta["category"], "title": a["title"], "description": a["description"],
            "updated": date.today().isoformat(),
        }
        (folder / "index.html").write_text("---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n", encoding="utf-8")
print("article pages written")
