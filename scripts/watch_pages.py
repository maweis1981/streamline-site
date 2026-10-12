"""Write the "free TV by country" articles (/watch/<code>/) and their hub (/watch/).

Facts per country live in _data/watch/facts/<code>.yml (English, with sources);
translated sentences in _data/watch/i18n/<lang>.yml. This script refreshes the English
sentences from the facts, then writes one page per country and language plus a hub
page per language. Run it after editing the facts or translations.
"""

from datetime import date
from pathlib import Path

import yaml
from babel import Locale

SITE = Path(__file__).resolve().parent.parent
BABEL_LOCALE = {"zh": "zh_Hans"}
TERRITORY = {"uk": "GB"}


def front_matter(fields: dict) -> str:
    return "---\n" + yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, width=1000) + "---\n"


def fill(template: str, **values: str) -> str:
    for key, value in values.items():
        template = template.replace(f"%{key}%", value)
    return template


config = yaml.safe_load((SITE / "_config.yml").read_text(encoding="utf-8"))
languages, default_lang = config["languages"], config["default_lang"]
facts = {p.stem: yaml.safe_load(p.read_text(encoding="utf-8")) for p in sorted((SITE / "_data/watch/facts").glob("*.yml"))}

# English sentences come straight from the facts files.
i18n_dir = SITE / "_data/watch/i18n"
i18n_dir.mkdir(parents=True, exist_ok=True)
english = {code: {"dtt": f["dtt"]["summary"], "services": [s["summary"] for s in f["services"]], "notes": f.get("notes") or []}
           for code, f in facts.items()}
(i18n_dir / "en.yml").write_text(yaml.safe_dump(english, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")

year = str(date.today().year)
for lang in languages:
    if not (i18n_dir / f"{lang}.yml").exists():
        continue  # not translated yet
    strings = yaml.safe_load((SITE / "_data/locales" / f"{lang}.yml").read_text(encoding="utf-8"))["watch"]
    locale = Locale.parse(BABEL_LOCALE.get(lang, lang))
    root = SITE / ("watch" if lang == default_lang else f"{lang}/watch")
    root.mkdir(parents=True, exist_ok=True)
    (root / "index.html").write_text(front_matter({
        "layout": "watch-index", "lang": lang, "ref": "watch", "path_key": "watch/",
        "title": strings["hub_title"], "description": strings["hub_desc"],
    }), encoding="utf-8")
    for code, f in facts.items():
        name = locale.territories.get(TERRITORY.get(code, code.upper()), f["country"])
        apps = ", ".join(s["name"] for s in f["services"][:3])
        page = root / code
        page.mkdir(exist_ok=True)
        (page / "index.html").write_text(front_matter({
            "layout": "watch", "lang": lang, "ref": f"watch-{code}", "path_key": f"watch/{code}/",
            "code": code, "country_name": name, "apps": apps,
            "title": fill(strings["title"], country=name, year=year),
            "description": fill(strings["description"], country=name, year=year, apps=apps),
            "updated": date.today().isoformat(),
        }), encoding="utf-8")
print(f"{len(facts)} countries")
