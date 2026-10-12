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
  published?: string;
  kind?: string;
}

export interface VodSection {
  id: string;
  kind: "archive" | "youtube";
  items: VodItem[];
}

export async function loadVod(url: string): Promise<VodSection[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { sections: VodSection[] };
    for (const s of data.sections) for (const i of s.items) i.kind = s.id;
    return data.sections;
  } catch {
    return [];
  }
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
