// Strings come from the Jekyll locale files (_data/locales/<lang>.yml, key "web"),
// injected by the page as window.DOUBO_WEB so the app and the site share one translation source.

export interface WebConfig {
  lang: string;
  appUrl: string;        // download section of the localized home page
  directoryUrl: string;  // localized channel directory
  freePlaylistUrl: string; // the iptv-playlists index (all free channels)
  playableUrl: string;
  vodUrl: string;        // on-demand sections collected by scripts/vod.py   // hashes of streams verified to play on doubo.tv (scripts/web_playable.py)
  categories: Record<string, string>; // localized category names by id
  strings: Record<string, string>;
}

declare global {
  interface Window {
    DOUBO_WEB?: WebConfig;
    slTrack?: (event: string, params?: Record<string, unknown>) => void;
  }
}

export const config: WebConfig = window.DOUBO_WEB ?? {
  lang: "en",
  appUrl: "/",
  directoryUrl: "/playlists/",
  freePlaylistUrl: "https://cdn.jsdelivr.net/gh/streamline-iptv/iptv-playlists@dist/index.m3u",
  playableUrl: "/web/playable.json",
  vodUrl: "/web/vod.json",
  categories: {},
  strings: {},
};

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let s = config.strings[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`%${k}%`).join(String(v));
  return s;
}

export function track(event: string, params: Record<string, unknown> = {}): void {
  window.slTrack?.(event, params);
}
