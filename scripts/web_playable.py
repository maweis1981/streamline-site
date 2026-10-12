"""List which directory streams a browser on doubo.tv can actually play.

A stream is web-playable when it is HTTPS, needs no custom request headers, every
request on the way (master playlist, variant playlist, first segment) answers with
an Access-Control-Allow-Origin header that admits https://doubo.tv, the variant is
not HEVC, and the first segment is real audio/video.

Only FNV-1a hashes of the stream URLs (and the ids of channels with at least one
playable stream) are written (web/playable.json), so the site
itself carries no stream links; the web player fetches the playlist from the
iptv-playlists repository and keeps the entries whose URL hash is listed.

Usage: python scripts/web_playable.py INDEX_M3U OUT_JSON
"""

import concurrent.futures
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ORIGIN = "https://doubo.tv"
TIMEOUT = 10
HEADERS = {"Origin": ORIGIN, "User-Agent": "Mozilla/5.0 (Doubo web check)"}


def fnv1a(text: str) -> str:
    """32-bit FNV-1a over UTF-8 bytes; mirrored by web-app/src/hash.ts."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def parse_entries(text: str) -> list[tuple[str, bool, str]]:
    """(url, needs_headers, channel_id) for each entry of an M3U playlist."""
    entries, needs_headers, in_entry, channel = [], False, False, ""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF"):
            in_entry, needs_headers = True, False
            m = re.search(r'tvg-id="([^"@]*)', line)
            channel = m.group(1) if m else ""
        elif line.startswith("#EXTVLCOPT"):
            needs_headers = True
        elif line and not line.startswith("#") and in_entry:
            entries.append((line, needs_headers, channel))
            in_entry = False
    return entries


def fetch(url: str, limit: int) -> tuple[str, bytes]:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        allow = response.headers.get("Access-Control-Allow-Origin", "")
        if allow not in ("*", ORIGIN) or response.status >= 400:
            raise PermissionError(allow)
        if not response.geturl().startswith("https://"):
            raise PermissionError("redirected to http")
        return response.geturl(), response.read(limit)


def looks_like_media(data: bytes) -> bool:
    if len(data) >= 189 and data[0] == 0x47 and data[188] == 0x47:
        return True
    if data[4:8] in (b"ftyp", b"styp", b"moof", b"sidx", b"moov"):
        return True
    return data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xF0 == 0xF0)


def pick_variant(master: str, base: str) -> str | None:
    lines = master.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            codecs = re.search(r'CODECS="([^"]*)"', line)
            if codecs and re.search(r"hvc1|hev1|dvh1", codecs.group(1)):
                continue
            for nxt in lines[i + 1:]:
                nxt = nxt.strip()
                if nxt and not nxt.startswith("#"):
                    return urljoin(base, nxt)
    return None


def first_segment(media: str, base: str) -> str | None:
    for line in media.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return urljoin(base, line)
    return None


def web_playable(url: str, needs_headers: bool) -> bool:
    if needs_headers or not url.startswith("https://"):
        return False
    try:
        final, body = fetch(url, 512 * 1024)
        if looks_like_media(body):
            return True
        text = body.decode("utf-8", errors="replace")
        if not text.lstrip("﻿").startswith("#EXTM3U"):
            return False
        if "#EXT-X-STREAM-INF" in text:
            variant = pick_variant(text, final)
            if variant is None:
                return False
            final, body = fetch(variant, 512 * 1024)
            text = body.decode("utf-8", errors="replace")
        segment = first_segment(text, final)
        if segment is None:
            return False
        _, data = fetch(segment, 4096)
        return "METHOD=AES-128" in text or looks_like_media(data)
    except Exception:
        return False


def main(index_path: str, out_path: str) -> None:
    entries = parse_entries(Path(index_path).read_text(encoding="utf-8", errors="replace"))
    with concurrent.futures.ThreadPoolExecutor(64) as pool:
        results = list(pool.map(lambda e: web_playable(e[0], e[1]), entries))
    hashes = sorted({fnv1a(url) for (url, _, _), ok in zip(entries, results) if ok})
    channels = sorted({cid for (_, _, cid), ok in zip(entries, results) if ok and cid})
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hashes": hashes,
        "channels": channels,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"web-playable: {len(hashes)}/{len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
