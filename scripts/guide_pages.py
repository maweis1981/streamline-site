"""Write one page per device guide and language from _data/guides/<lang>.yml.

Run after editing the guides: python scripts/guide_pages.py
"""

from pathlib import Path

import yaml

SITE = Path(__file__).resolve().parent.parent

config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
for lang in config["languages"]:
    source = SITE / "_data" / "guides" / f"{lang}.yml"
    if not source.exists():
        continue  # not translated yet; the guide hub hides itself for this language
    guides = yaml.safe_load(source.read_text(encoding="utf-8"))
    for item in config["guide_devices"]:
        key = item["key"]
        g = guides["devices"][key]
        folder = SITE / ("guide" if lang == config["default_lang"] else f"{lang}/guide") / key
        folder.mkdir(parents=True, exist_ok=True)
        fields = {
            "layout": "device-guide", "lang": lang, "ref": f"guide-{key}", "path_key": f"guide/{key}/",
            "device": key, "title": g["title"], "description": g["description"],
        }
        (folder / "index.html").write_text("---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n", encoding="utf-8")
print("guide pages written")
