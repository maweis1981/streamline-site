// On-demand videos: public-domain / Creative Commons films from the Internet Archive
// (played in our player) and official free YouTube channels (played in YouTube's embed).
// The list is collected at deploy time by scripts/vod.py into /web/vod.json.

export interface VodItem {
  id: string;
  title: string;
  description?: string;
  thumb: string;
  year?: string;
  src?: string;       // Internet Archive MP4
  licence?: string;
  page?: string;
  video?: string;     // YouTube video id
  channel?: string;
  channel_id?: string;
  published?: string;
  kind?: string;
  regions?: string[]; // countries the owner allows, when limited
}

export interface VodSection {
  id: string;
  kind: "archive" | "youtube";
  items: VodItem[];
}

/** Sections with only what should play here: no videos limited to other countries, none that failed before. */
export async function loadVod(url: string, unavailable: Set<string>): Promise<VodSection[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { sections: VodSection[]; tz?: Record<string, string> };
    const country = visitorCountry(data.tz ?? {});
    for (const s of data.sections) {
      s.items = s.items.filter((i) => !unavailable.has(i.id) && !unavailable.has(`ch:${i.channel_id}`) && (!country || !i.regions || i.regions.includes(country)));
      for (const i of s.items) i.kind = s.id;
    }
    return data.sections.filter((s) => s.items.length);
  } catch {
    return [];
  }
}

/** Best guess at the visitor's country without asking a server: the device time zone, then the language region. */
export function visitorCountry(tz: Record<string, string>): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && tz[zone]) return tz[zone];
  } catch {
    /* no Intl time zone support */
  }
  const region = /^[a-z]{2,3}-([A-Z]{2})\b/.exec(navigator.language ?? "");
  return region ? region[1] : "";
}

/** Drop one item everywhere (after YouTube refused to play it here). */
export function removeVod(sections: VodSection[], id: string): VodSection[] {
  for (const s of sections) s.items = s.items.filter((i) => i.id !== id);
  return sections.filter((s) => s.items.length);
}

export function vodItems(section: VodSection, channel: string, query: string): VodItem[] {
  const q = query.trim().toLowerCase();
  return section.items.filter((i) => (!channel || i.channel === channel) && (!q || i.title.toLowerCase().includes(q)));
}

export function vodTile(item: VodItem, esc: (s: string) => string): string {
  const meta = [item.channel, item.year].filter(Boolean).join(" · ");
  return `<li class="dw-tile dw-vod"><button type="button" class="dw-tile-btn" data-vod="${esc(item.id)}">
    <span class="dw-tile-media"><img class="dw-vod-thumb" src="${esc(item.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="dw-vod-play" aria-hidden="true">▶</span></span>
    <span class="dw-tile-name">${esc(item.title)}</span>
    <span class="dw-tile-meta">${esc(meta)}</span>
  </button></li>`;
}
