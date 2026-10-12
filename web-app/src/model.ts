// Domain model, mirroring the iOS app: a playlist holds channels, and a channel
// can be reachable through several routes (stream URLs) that the player can switch between.

export interface Route {
  url: string;
  label: string;          // e.g. "HD", "SD", or the original title when it differs
  referrer?: string;      // from #EXTVLCOPT; browsers cannot send these, see Route checks
  userAgent?: string;
}

export interface Channel {
  key: string;            // stable within a playlist: tvg-id, else the normalized name
  name: string;
  group: string;
  country?: string;       // ISO 3166 code from tvg-country, when the playlist has one
  logo?: string;
  routes: Route[];
}

export interface PlaylistSource {
  kind: "url" | "file" | "text";
  url?: string;
}

export interface Playlist {
  id: string;
  name: string;
  source: PlaylistSource;
  channels: Channel[];
  importedAt: number;
}

/** Why a route cannot be tried in a browser at all (before any network request). */
export type RouteLimit = "insecure" | "headers" | null;

export function routeLimit(route: Route, pageIsSecure: boolean): RouteLimit {
  if (pageIsSecure && route.url.startsWith("http://")) return "insecure";
  if (route.referrer || route.userAgent) return "headers";
  return null;
}

export function favoriteId(playlistId: string, channelKey: string): string {
  return `${playlistId}::${channelKey}`;
}
