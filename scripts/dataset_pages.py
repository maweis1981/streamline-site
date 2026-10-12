"""Write the dataset page (/data/free-tv-channels/) for every site language.

The numbers come from _data/dataset.json, which scripts/channels.py writes at deploy time.
"""

from pathlib import Path

import yaml

SITE = Path(__file__).resolve().parent.parent
config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
for lang in config["languages"]:
    s = yaml.safe_load((SITE / "_data/locales" / f"{lang}.yml").read_text(encoding="utf-8"))["dataset"]
    folder = SITE / ("data" if lang == config["default_lang"] else f"{lang}/data") / "free-tv-channels"
    folder.mkdir(parents=True, exist_ok=True)
    fields = {"layout": "dataset", "lang": lang, "ref": "dataset", "path_key": "data/free-tv-channels/",
              "title": s["title"], "description": s["description"]}
    (folder / "index.html").write_text("---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n", encoding="utf-8")
print("dataset pages written")
