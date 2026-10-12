"""Collect on-demand videos for the web player (web/vod.json).

Reads _data/vod/sources.yml. Internet Archive sections keep only items whose metadata
has a public-domain or Creative Commons licence URL and an MP4 file a browser can play.
YouTube sections resolve each official channel handle to its channel id and read the
channel's public feed (latest uploads), so nothing needs an API key.

Usage: python scripts/vod.py OUT_JSON
"""

import concurrent.futures
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import yaml

SITE = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Doubo on-demand collector; +https://doubo.tv)", "Accept-Language": "en"}
MP4_FORMATS = ["h.264 HD", "h.264", "MPEG4", "512Kb MPEG4", "h.264 IA"]
# Public domain is not the same as suitable: keep exploitation and adult titles out.
BLOCKED_WORDS = re.compile(r"\b(sex|sexual|nude|nudity|erotic|adult|stag|burlesque|strip|marihuana|marijuana|reefer|cocaine|narcotic)\b", re.I)


def get(url: str, timeout: int = 30) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def clean(text: str, limit: int = 280) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def archive_item(identifier: str) -> dict | None:
    meta = json.loads(get(f"https://archive.org/metadata/{urllib.parse.quote(identifier)}"))
    m = meta.get("metadata", {})
    licence = m.get("licenseurl", "")
    if not re.search(r"publicdomain|creativecommons", licence):
        return None
    subjects = m.get("subject") if isinstance(m.get("subject"), list) else [m.get("subject") or ""]
    if BLOCKED_WORDS.search(" ".join([str(m.get("title", "")), " ".join(map(str, subjects)), str(m.get("description", ""))[:600]])):
        return None
    files = [f for f in meta.get("files", []) if f.get("name", "").lower().endswith(".mp4")]
    files.sort(key=lambda f: MP4_FORMATS.index(f["format"]) if f.get("format") in MP4_FORMATS else len(MP4_FORMATS))
    if not files:
        return None
    best = files[0]
    title = m.get("title") if isinstance(m.get("title"), str) else (m.get("title") or [identifier])[0]
    description = m.get("description") if isinstance(m.get("description"), str) else " ".join(m.get("description") or [])
    year = str(m.get("year") or m.get("date") or "")[:4]
    return {
        "id": f"ia:{identifier}", "title": clean(title, 120), "year": year if year.isdigit() else "",
        "description": clean(description), "thumb": f"https://archive.org/services/img/{identifier}",
        "src": f"https://archive.org/download/{urllib.parse.quote(identifier)}/{urllib.parse.quote(best['name'])}",
        "length": str(best.get("length") or ""), "licence": licence, "page": f"https://archive.org/details/{identifier}",
    }


def archive_section(query: str, rows: int, title_starts: list[str] | None = None) -> list[dict]:
    params = urllib.parse.urlencode({"q": query, "fl[]": "identifier", "sort[]": "downloads desc", "rows": rows, "output": "json"}, doseq=True)
    docs = json.loads(get(f"https://archive.org/advancedsearch.php?{params}"))["response"]["docs"]
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        items = list(pool.map(lambda d: _safe(archive_item, d["identifier"]), docs))
    items = [i for i in items if i]
    if title_starts:
        items = [i for i in items if any(i["title"].lower().startswith(t.lower()) for t in title_starts)]
    return items


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception as error:  # one broken item should not stop the build
        print(f"  skipped {args[0]}: {error}")
        return None


def channel_id(handle: str) -> str | None:
    html = get(f"https://www.youtube.com/@{handle}").decode("utf-8", errors="replace")
    m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', html) \
        or re.search(r'"(?:externalId|channelId)":"(UC[\w-]{22})"', html)
    return m.group(1) if m else None


def embeddable(video: str) -> bool:
    """YouTube's oEmbed endpoint answers 401 when the owner has turned embedding off."""
    try:
        get(f"https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={video}", timeout=15)
        return True
    except Exception:
        return False


def youtube_channel(ch: dict) -> list[dict]:
    cid = ch.get("id") or channel_id(ch["handle"])
    if not cid:
        print(f"  no channel id for @{ch['handle']}")
        return []
    feed = ET.fromstring(get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"))
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}
    items = []
    for entry in feed.findall("a:entry", ns):
        vid = entry.findtext("yt:videoId", namespaces=ns)
        group = entry.find("media:group", ns)
        title = entry.findtext("a:title", namespaces=ns) or ""
        link = entry.find("a:link", ns)
        if not vid or "/shorts/" in (link.get("href", "") if link is not None else "") or re.search(r"#?shorts\b", title, re.I):
            continue
        items.append({
            "id": f"yt:{vid}", "video": vid, "title": clean(entry.findtext("a:title", namespaces=ns), 140),
            "channel": ch["name"], "channel_id": cid, "published": (entry.findtext("a:published", namespaces=ns) or "")[:10],
            "description": clean(group.findtext("media:description", namespaces=ns) if group is not None else ""),
            "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        })
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        allowed = list(pool.map(lambda i: embeddable(i["video"]), items))
    items = [i for i, ok in zip(items, allowed) if ok]
    print(f"  @{ch['handle']}: {cid}, {len(items)} embeddable videos")
    return items


def main(out_path: str) -> None:
    config = yaml.safe_load((SITE / "_data/vod/sources.yml").read_text(encoding="utf-8"))
    sections = []
    for sec in config["sections"]:
        print(f"section {sec['id']}")
        if sec["kind"] == "archive":
            items = _safe(archive_section, sec["query"], sec.get("rows", 50), sec.get("title_starts")) or []
        else:
            items = [i for ch in sec["channels"] for i in (_safe(youtube_channel, ch) or [])]
        seen, unique = set(), []
        for i in items:
            if i["id"] not in seen:
                seen.add(i["id"])
                unique.append(i)
        print(f"  {len(unique)} items")
        if unique:
            sections.append({"id": sec["id"], "kind": sec["kind"], "items": unique})
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sections": sections},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} with {sum(len(s['items']) for s in sections)} items")


if __name__ == "__main__":
    main(sys.argv[1])
