"""Generate one page per directory channel and site language (/channels/<slug>/).

Inputs: the iptv-playlists index.m3u (which channels are listed, their languages and
logos), the iptv-org channels.csv (network, owners, launch date, website), the
playability results from scripts/web_playable.py, and _data/directory.json written by
scripts/directory.py (localized country names). All text is resolved here so the Liquid
layout stays a plain template; pages are not committed (see .gitignore).

Channels with at least one stream that plays in a browser are indexed; the others get
noindex so search engines only see pages a visitor can act on right away.

It also writes the dataset behind /data/free-tv-channels/ (_data/dataset.json and data/*.csv|json).

Usage: python scripts/channels.py INDEX_M3U CHANNELS_CSV PLAYABLE_JSON
"""

import csv
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml
from babel import Locale
from babel.core import get_global

SITE = Path(__file__).resolve().parent.parent
BABEL_LOCALE = {"zh": "zh_Hans"}
RELATED = 12


def slugify(channel_id: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", channel_id.lower()).strip("-")


def fill(template: str, **values: str) -> str:
    for key, value in values.items():
        template = template.replace(f"%{key}%", value)
    return template


def front_matter(fields: dict) -> str:
    return "---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n"


def listed_channels(m3u: str) -> dict[str, dict]:
    """Channel id -> {languages, logo} for every channel in the playlist."""
    found: dict[str, dict] = {}
    for line in m3u.splitlines():
        if not line.startswith("#EXTINF"):
            continue
        attrs = dict(re.findall(r'([a-z-]+)="([^"]*)"', line))
        cid = attrs.get("tvg-id", "").split("@")[0]
        if not cid:
            continue
        entry = found.setdefault(cid, {"languages": [], "logo": ""})
        for lang in filter(None, attrs.get("tvg-language", "").split(";")):
            if lang not in entry["languages"]:
                entry["languages"].append(lang)
        entry["logo"] = entry["logo"] or attrs.get("tvg-logo", "")
    return found


def write_dataset(channels: list[dict], countries: dict) -> None:
    """Files behind /data/free-tv-channels/: a country summary (for the page, CSV and JSON) and a
    channel-level CSV. Metadata only: no stream URLs leave this script."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    per_country: dict[str, dict] = {}
    categories: dict[str, int] = defaultdict(int)
    for c in channels:
        row = per_country.setdefault(c["country"], {"code": c["country"], "listed": 0, "web_playable": 0})
        row["listed"] += 1
        row["web_playable"] += int(c["playable"])
        for cat in c["categories"]:
            categories[cat] += 1
    summary = sorted(per_country.values(), key=lambda r: (-r["listed"], r["code"]))
    stats = {
        "generated_at": today,
        "channels": len(channels),
        "web_playable": sum(c["playable"] for c in channels),
        "countries": len(summary),
        "country_rows": summary,
        "categories": [{"id": k, "channels": v} for k, v in sorted(categories.items(), key=lambda kv: (-kv[1], kv[0]))],
    }
    (SITE / "_data" / "dataset.json").write_text(json.dumps(stats, ensure_ascii=False), encoding="utf-8")

    out = SITE / "data"   # also holds the generated dataset page, so files are overwritten, not the folder
    out.mkdir(exist_ok=True)
    names = {code: info["names"]["en"] for code, info in countries.items()}
    with (out / "free-tv-channels-by-country.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["country_code", "country", "channels_listed", "channels_playable_in_browser", "as_of"])
        for r in summary:
            w.writerow([r["code"].upper(), names.get(r["code"], r["code"]), r["listed"], r["web_playable"], today])
    with (out / "free-tv-channels.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["channel_id", "name", "country_code", "categories", "languages", "network", "owners", "launched", "website", "playable_in_browser", "as_of"])
        for c in channels:
            w.writerow([c["id"], c["name"], c["country"].upper(), ";".join(c["categories"]), ";".join(c["languages"]),
                        c["network"], ";".join(c["owners"]), c["launched"], c["website"], int(c["playable"]), today])
    (out / "free-tv-channels-by-country.json").write_text(json.dumps({
        "name": "Free TV channels by country (Doubo Public Channel Directory)",
        "license": "CC BY 4.0",
        "attribution": "Doubo Public Channel Directory, https://doubo.tv/data/free-tv-channels/",
        "as_of": today, "channels_listed": stats["channels"], "channels_playable_in_browser": stats["web_playable"],
        "countries": [{"code": r["code"].upper(), "name": names.get(r["code"], r["code"]), "channels_listed": r["listed"],
                       "channels_playable_in_browser": r["web_playable"]} for r in summary],
    }, ensure_ascii=False, indent=1), encoding="utf-8")


def main(m3u_path: str, channels_csv: str, playable_path: str) -> None:
    config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
    languages, default_lang = config["languages"], config["default_lang"]
    locales = {l: yaml.safe_load((SITE / "_data" / "locales" / f"{l}.yml").read_text(encoding="utf-8")) for l in languages}
    babel = {l: Locale.parse(BABEL_LOCALE.get(l, l)) for l in languages}
    aliases = get_global("language_aliases")
    directory = json.loads((SITE / "_data" / "directory.json").read_text(encoding="utf-8"))
    countries = {c["code"]: c for c in directory["countries"]}
    try:
        playable = set(json.loads(Path(playable_path).read_text(encoding="utf-8")).get("channels", []))
    except (OSError, ValueError):
        playable = set()

    listed = listed_channels(Path(m3u_path).read_text(encoding="utf-8", errors="replace"))
    meta = {r["id"]: r for r in csv.DictReader(open(channels_csv, encoding="utf-8")) if r["id"] in listed}

    channels = []
    for cid, info in listed.items():
        row = meta.get(cid)
        if not row:
            continue
        code = row["country"].lower()
        if code not in countries:
            continue
        channels.append({
            "id": cid, "slug": slugify(cid), "name": row["name"], "country": code,
            "categories": [c for c in row["categories"].split(";") if c and c != "xxx"],
            "network": row["network"], "owners": [o for o in row["owners"].split(";") if o],
            "launched": row["launched"][:4], "website": row["website"],
            "languages": info["languages"], "logo": info["logo"], "playable": cid in playable,
        })
    channels.sort(key=lambda c: (c["country"], c["name"].lower()))

    by_country = defaultdict(list)
    for c in channels:
        by_country[c["country"]].append(c)

    write_dataset(channels, countries)

    # Lets directory pages link channel names to their pages.
    slugs = {f"{c['country']}:{c['name']}": c["slug"] for c in channels}
    (SITE / "_data" / "channel_slugs.json").write_text(json.dumps(slugs, ensure_ascii=False), encoding="utf-8")
    # ...and show each channel's logo next to its name.
    logos = {f"{c['country']}:{c['name']}": c["logo"] for c in channels if c["logo"].startswith("https://")}
    (SITE / "_data" / "channel_logos.json").write_text(json.dumps(logos, ensure_ascii=False), encoding="utf-8")

    for lang in languages:
        s = locales[lang]["channel"]
        categories = locales[lang]["directory"]["categories"]
        root = SITE / ("channels" if lang == default_lang else f"{lang}/channels")
        shutil.rmtree(root, ignore_errors=True)
        for c in channels:
            country = countries[c["country"]]["names"][lang]
            category = categories.get(c["categories"][0], c["categories"][0]) if c["categories"] else categories.get("general", "")
            # Mid-sentence, Latin-script languages write the category in lower case ("a news channel").
            v = {"name": c["name"], "country": country, "category": category if lang in ("zh", "th") else category.lower()}
            language_names = [babel[lang].languages.get(aliases.get(x, x)) or x for x in c["languages"]]

            summary = [fill(s["summary"], **v)]
            if c["network"]:
                summary.append(fill(s["summary_network"], network=c["network"]))
            if c["owners"]:
                summary.append(fill(s["summary_owner"], owner=", ".join(c["owners"])))
            if c["launched"]:
                summary.append(fill(s["summary_launched"], launched=c["launched"]))

            facts = [{"label": s["f_country"], "value": country, "href": f"playlists/{c['country']}/"}]
            if c["categories"]:
                facts.append({"label": s["f_category"], "value": " · ".join(categories.get(x, x) for x in c["categories"]),
                              "href": f"playlists/category/{c['categories'][0]}/"})
            if language_names:
                facts.append({"label": s["f_language"], "value": " · ".join(language_names)})
            if c["network"]:
                facts.append({"label": s["f_network"], "value": c["network"]})
            if c["owners"]:
                facts.append({"label": s["f_owner"], "value": ", ".join(c["owners"])})
            if c["launched"]:
                facts.append({"label": s["f_launched"], "value": c["launched"]})
            if c["website"]:
                facts.append({"label": s["f_website"], "value": re.sub(r"^https?://(www\.)?|/$", "", c["website"]), "url": c["website"]})

            faq = [{"q": fill(s["q_free"], **v), "a": fill(s["a_free"], **v)},
                   {"q": fill(s["q_tv"], **v), "a": fill(s["a_tv"], **v)}]
            if c["website"]:
                faq.append({"q": fill(s["q_site"], **v), "a": fill(s["a_site"], website=c["website"], **v)})

            peers = sorted((p for p in by_country[c["country"]] if p is not c), key=lambda p: (not p["playable"], p["name"].lower()))
            page = root / c["slug"]
            page.mkdir(parents=True, exist_ok=True)
            (page / "index.html").write_text(front_matter({
                "layout": "channel", "lang": lang, "ref": f"channel-{c['slug']}", "path_key": f"channels/{c['slug']}/",
                "title": fill(s["title"], **v), "description": fill(s["description"], **v),
                "noindex": not c["playable"],
                "channel": {
                    "id": c["id"], "name": c["name"], "country": c["country"], "country_name": country,
                    "flag": countries[c["country"]]["flag"], "logo": c["logo"], "website": c["website"],
                    "playable": c["playable"], "network": c["network"], "owners": c["owners"],
                    "languages": c["languages"], "category": category,
                    "h1": fill(s["h1"], **v),
                    "lead": fill(s["lead_playable" if c["playable"] else "lead_other"], **v),
                    "summary": " ".join(summary), "facts": facts, "faq": faq,
                    "related_title": fill(s["related"], **v),
                    "related": [{"slug": p["slug"], "name": p["name"], "logo": p["logo"]} for p in peers[:RELATED]],
                },
            }), encoding="utf-8")
    indexed = sum(c["playable"] for c in channels)
    print(f"{len(channels)} channel pages x {len(languages)} languages ({indexed} indexed)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
