"""Prepare the channel directory pages from the iptv-playlists index.

Reads index.json published by streamline-iptv/iptv-playlists, adds localized country
and language names, writes _data/directory.json and generates one directory
page plus one page per country for every site language. Generated pages are
not committed (see .gitignore); the deploy workflow runs this before Jekyll.

Usage: python scripts/directory.py INDEX_JSON
"""

import json
import shutil
import sys
from pathlib import Path

import yaml
from babel import Locale
from babel.core import get_global

SITE = Path(__file__).resolve().parent.parent
PLAYLISTS = "https://cdn.jsdelivr.net/gh/streamline-iptv/iptv-playlists@dist"
MIRROR = "https://raw.githubusercontent.com/streamline-iptv/iptv-playlists/dist"
REPO = "https://github.com/streamline-iptv/iptv-playlists"
BABEL_LOCALE = {"zh": "zh_Hans"}
TERRITORY = {"uk": "GB"}  # iptv-org uses UK for the United Kingdom
MIN_LANGUAGE_CHANNELS = 5
MIN_INDEXED_CHANNELS = 3  # smaller pages stay reachable but are kept out of search indexes (thin content)


def flag(territory: str) -> str:
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in territory) if len(territory) == 2 else ""


def fill(template: str, **values) -> str:
    for key, value in values.items():
        template = template.replace(f"%{key}%", str(value))
    return template


def front_matter(fields: dict) -> str:
    return "---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n"


def main(index_path: str) -> None:
    config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
    languages, default_lang = config["languages"], config["default_lang"]
    locales = {l: Locale.parse(BABEL_LOCALE.get(l, l)) for l in languages}
    strings = {l: yaml.safe_load((SITE / "_data" / "locales" / f"{l}.yml").read_text(encoding="utf-8"))["directory"] for l in languages}
    aliases = get_global("language_aliases")
    index = json.loads(Path(index_path).read_text(encoding="utf-8"))

    countries = []
    for c in index["countries"]:
        territory = TERRITORY.get(c["code"], c["code"].upper())
        names = {l: locales[l].territories.get(territory, territory) for l in languages}
        countries.append({**c, "flag": flag(territory), "names": names, "count": len(c["channels"])})
    countries.sort(key=lambda c: (-c["count"], c["code"]))

    spoken = []
    for lang in index["languages"]:
        if lang["channels"] < MIN_LANGUAGE_CHANNELS:
            continue
        short = aliases.get(lang["code"], lang["code"])
        names = {l: (locales[l].languages.get(short) or lang["name"]) for l in languages}
        spoken.append({**lang, "names": names})

    # Category pages list each channel with its country; built from the per-country channel lists.
    by_category: dict[str, dict[str, dict]] = {}
    for c in countries:
        for ch in c["channels"]:
            for cat in ch["categories"]:
                by_category.setdefault(cat, {})[f"{c['code']}:{ch['name']}"] = {"name": ch["name"], "country": c["code"]}
    categories = []
    for cat in index["categories"]:
        if cat["id"] == "xxx" or cat["id"] not in by_category:
            continue
        chans = sorted(by_category[cat["id"]].values(), key=lambda x: (x["country"], x["name"].lower()))
        categories.append({**cat, "list": chans, "count": len(chans), "country_count": len({x["country"] for x in chans})})

    data = {
        "generated_at": index["generated_at"],
        "date": index["generated_at"][:10],
        "channels": index["channels"],
        "streams": index["streams"],
        "base_url": PLAYLISTS,
        "mirror_url": MIRROR,
        "repo_url": REPO,
        "countries": countries,
        "categories": categories,
        "languages": spoken,
    }
    (SITE / "_data" / "directory.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    for lang in languages:
        root = SITE / ("playlists" if lang == default_lang else f"{lang}/playlists")
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True)
        s = strings[lang]
        (root / "index.html").write_text(front_matter({
            "layout": "directory", "lang": lang, "ref": "playlists", "path_key": "playlists/",
            "title": s["index_title"], "description": s["index_desc"],
        }), encoding="utf-8")
        for c in countries:
            name, count = c["names"][lang], c["count"]
            page = root / c["code"]
            page.mkdir()
            (page / "index.html").write_text(front_matter({
                "layout": "directory-country", "lang": lang, "ref": f"playlists-{c['code']}",
                "path_key": f"playlists/{c['code']}/", "country": c["code"],
                "title": fill(s["country_title"], country=name, count=count),
                "description": fill(s["country_desc"], country=name, count=count),
                "noindex": count < MIN_INDEXED_CHANNELS,
            }), encoding="utf-8")
        for cat in categories:
            name, count = s["categories"].get(cat["id"], cat["id"]), cat["count"]
            page = root / "category" / cat["id"]
            page.mkdir(parents=True)
            (page / "index.html").write_text(front_matter({
                "layout": "directory-category", "lang": lang, "ref": f"playlists-category-{cat['id']}",
                "path_key": f"playlists/category/{cat['id']}/", "category": cat["id"],
                "title": fill(s["category_title"], category=name, count=count),
                "description": fill(s["category_desc"], category=name, count=count),
                "noindex": count < MIN_INDEXED_CHANNELS,
            }), encoding="utf-8")
    print(f"{len(countries)} countries, {len(categories)} categories x {len(languages)} languages")


if __name__ == "__main__":
    main(sys.argv[1])
