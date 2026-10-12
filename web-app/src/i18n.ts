// Strings come from the Jekyll locale files (_data/locales/<lang>.yml, key "web"),
// injected by the page as window.DOUBO_WEB so the app and the site share one translation source.

export interface WebConfig {
  lang: string;
  appUrl: string;        // download section of the localized home page
  directoryUrl: string;  // localized channel directory
  strings: Record<string, string>;
}

declare global {
  interface Window {
    DOUBO_WEB?: WebConfig;
    slTrack?: (event: string, params?: Record<string, unknown>) => void;
  }
}

export const config: WebConfig = window.DOUBO_WEB ?? { lang: "en", appUrl: "/", directoryUrl: "/playlists/", strings: {} };

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let s = config.strings[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`%${k}%`).join(String(v));
  return s;
}

export function track(event: string, params: Record<string, unknown> = {}): void {
  window.slTrack?.(event, params);
}
