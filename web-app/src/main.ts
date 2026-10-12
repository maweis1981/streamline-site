import "./styles.css";
import { fnv1a } from "./hash";
import { config, t, track } from "./i18n";
import { groupsOf, parseM3U } from "./m3u";
import type { Channel, Playlist, PlaylistSource } from "./model";
import { favoriteId } from "./model";
import { Player } from "./player";
import { PreviewWall, webRoutes } from "./preview";
import { type VodItem, type VodSection, loadVod, vodItems, vodTile } from "./vod";
import { deletePlaylist, loadPlaylists, readPref, savePlaylist, writePref } from "./store";

// Sources shown as chips: the free channel directory, favorites across sources, then the visitor's playlists.
const FREE = "free";
const FAVORITES = "favorites";
const PAGE_SIZE = 48;
const DEAD_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_MAX = 30;
const ROW_SIZE = 20;
const ROW_COUNT = 12;

// Recently watched, newest first: live channels (playlist + channel key) and on-demand items.
type HistoryEntry = { k: "live"; p: string; c: string; at: number } | { k: "vod"; id: string; at: number };

interface State {
  free: Playlist | null;
  playlists: Playlist[];
  source: string;
  group: string;      // "" = all
  country: string;    // "" = all
  query: string;
  favorites: Set<string>;
  dead: Record<string, number>;   // favoriteId -> time it was found unplayable here
  shown: number;
  playing: { playlistId: string; channel: Channel } | null;
  vod: VodSection[];
  vodPlaying: VodItem | null;
  history: HistoryEntry[];
}

const state: State = {
  free: null,
  playlists: [],
  source: readPref<string>("source", FREE),
  group: "",
  country: "",
  query: "",
  favorites: new Set(readPref<string[]>("favorites", [])),
  dead: pruneDead(readPref<Record<string, number>>("dead", {})),
  shown: PAGE_SIZE,
  playing: null,
  vod: [],
  vodPlaying: null,
  history: readPref<HistoryEntry[]>("history", []),
};
const VOD = "vod:"; // source ids for on-demand sections: "vod:<section id>"
const isVod = (source: string) => source.startsWith(VOD);
const liveRoute = new Map<string, number>(); // favoriteId -> route that played in the preview

function pruneDead(dead: Record<string, number>): Record<string, number> {
  const now = Date.now();
  return Object.fromEntries(Object.entries(dead).filter(([, at]) => now - at < DEAD_TTL_MS));
}

const root = document.getElementById("doubo-web")!;
root.innerHTML = `
  <div class="dw">
    <div class="dw-bar">
      <div class="dw-sources" role="tablist" aria-label="${t("playlists")}"></div>
      <div class="dw-filters">
        <select class="dw-country" aria-label="${t("all_countries")}" hidden></select>
        <input class="dw-search" type="search" placeholder="${t("search")}" aria-label="${t("search")}">
        <button type="button" class="dw-link" data-action="remove" hidden>${t("remove_playlist")}</button>
      </div>
      <div class="dw-groups" aria-label="${t("groups")}"></div>
    </div>
    <p class="dw-count" aria-live="polite"></p>
    <div class="dw-rows" hidden></div>
    <ul class="dw-grid"></ul>
    <div class="dw-more"><button type="button" class="dw-btn" data-action="more" hidden>${t("load_more")}</button></div>
    <div class="dw-empty" hidden>
      <h2>${t("empty_title")}</h2>
      <p>${t("empty_desc")}</p>
      <div class="dw-empty-actions"><button type="button" class="dw-btn dw-btn-primary" data-action="add">${t("add_playlist")}</button></div>
    </div>
    <p class="dw-note">${t("privacy_note")}</p>
  </div>
  <div class="dw-theater" hidden role="dialog" aria-modal="true">
    <div class="dw-theater-bar">
      <button type="button" class="dw-btn" data-action="close">← ${t("back")}</button>
      <div class="dw-now-title"><h1 class="dw-now-name"></h1><span class="dw-now-group"></span></div>
      <div class="dw-now-actions">
        <button type="button" class="dw-btn" data-action="prev" aria-label="${t("prev_channel")}">↑</button>
        <button type="button" class="dw-btn" data-action="next" aria-label="${t("next_channel")}">↓</button>
        <button type="button" class="dw-btn" data-action="share">↗ ${t("share")}</button>
        <button type="button" class="dw-btn" data-action="favorite"></button>
        <button type="button" class="dw-btn" data-action="pip">${t("pip")}</button>
        <button type="button" class="dw-btn" data-action="fullscreen">${t("fullscreen")}</button>
      </div>
    </div>
    <div class="dw-video-wrap">
      <video class="dw-video" controls playsinline autoplay></video>
      <div class="dw-embed" hidden></div>
      <div class="dw-overlay dw-app-hint" hidden>
        <h2>${t("app_hint_title")}</h2>
        <p>${t("app_hint_desc")}</p>
        <a class="dw-btn dw-btn-primary" href="${config.appUrl}" data-track="cta_click" data-track-target="download_anchor" data-track-location="web_player">${t("open_app")}</a>
      </div>
    </div>
    <div class="dw-routes" role="group" aria-label="${t("routes")}"></div>
    <p class="dw-attrib" hidden></p>
    <p class="dw-hint">${t("shortcuts")}</p>
  </div>
  <dialog class="dw-dialog">
    <form method="dialog" class="dw-form">
      <h2>${t("add_playlist")}</h2>
      <label>${t("url_label")}<input name="url" type="url" inputmode="url" placeholder="https://example.com/playlist.m3u"></label>
      <label>${t("name_label")}<input name="name" type="text" maxlength="80"></label>
      <label class="dw-file">${t("from_file")}<input name="file" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"></label>
      <details><summary>${t("paste_label")}</summary><textarea name="text" rows="5" spellcheck="false"></textarea></details>
      <p class="dw-form-msg" role="status"></p>
      <p class="dw-note">${t("privacy_note")}</p>
      <div class="dw-form-actions">
        <button type="button" class="dw-btn" data-action="cancel">${t("cancel")}</button>
        <button type="submit" class="dw-btn dw-btn-primary" value="add">${t("add")}</button>
      </div>
    </form>
  </dialog>`;

const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
const els = {
  sources: $<HTMLDivElement>(".dw-sources"),
  country: $<HTMLSelectElement>(".dw-country"),
  search: $<HTMLInputElement>(".dw-search"),
  remove: $<HTMLButtonElement>('[data-action="remove"]'),
  groups: $<HTMLDivElement>(".dw-groups"),
  count: $<HTMLParagraphElement>(".dw-count"),
  grid: $<HTMLUListElement>(".dw-grid"),
  rows: $<HTMLDivElement>(".dw-rows"),
  more: $<HTMLButtonElement>('[data-action="more"]'),
  empty: $<HTMLDivElement>(".dw-empty"),
  theater: $<HTMLDivElement>(".dw-theater"),
  video: $<HTMLVideoElement>(".dw-video"),
  appHint: $<HTMLDivElement>(".dw-app-hint"),
  nowName: $<HTMLHeadingElement>(".dw-now-name"),
  nowGroup: $<HTMLSpanElement>(".dw-now-group"),
  favorite: $<HTMLButtonElement>('[data-action="favorite"]'),
  pip: $<HTMLButtonElement>('[data-action="pip"]'),
  routes: $<HTMLDivElement>(".dw-routes"),
  embed: $<HTMLDivElement>(".dw-embed"),
  attrib: $<HTMLParagraphElement>(".dw-attrib"),
  prev: $<HTMLButtonElement>('[data-action="prev"]'),
  share: $<HTMLButtonElement>('[data-action="share"]'),
  next: $<HTMLButtonElement>('[data-action="next"]'),
  fullscreen: $<HTMLButtonElement>('[data-action="fullscreen"]'),
  dialog: $<HTMLDialogElement>(".dw-dialog"),
  form: $<HTMLFormElement>(".dw-form"),
  formMsg: $<HTMLParagraphElement>(".dw-form-msg"),
};

const smallScreen = matchMedia("(max-width: 639.98px)").matches;
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const wall = new PreviewWall(
  saveData ? 0 : smallScreen ? 4 : 9,
  (channel, routeIndex) => liveRoute.set(tileId(channel), routeIndex),
  (channel, el) => hide(tileOwner(el), channel, el),
);

const player = new Player(
  els.video,
  (index) => renderRoutes(index),
  () => {
    // Nothing plays in this browser: offer the app, and keep the channel off the wall from now on.
    els.appHint.hidden = false;
    if (state.playing) markDead(state.playing.playlistId, state.playing.channel);
    track("web_play_unavailable");
  },
);

// ---------------------------------------------------------------- helpers

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || config.lang], { type: "region" });
  } catch {
    return null;
  }
})();
const countryName = (code: string) => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};
const categoryName = (group: string) => config.categories?.[group.toLowerCase()] ?? group;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function sourcePlaylists(): Playlist[] {
  return [...(state.free ? [state.free] : []), ...state.playlists];
}

function playlistById(id: string): Playlist | undefined {
  return sourcePlaylists().find((p) => p.id === id);
}

let renderedOwners = new WeakMap<HTMLElement, string>();
function tileOwner(el: HTMLElement): string {
  return renderedOwners.get(el) ?? state.source;
}

function tileId(channel: Channel): string {
  for (const p of sourcePlaylists()) if (p.channels.includes(channel)) return favoriteId(p.id, channel.key);
  return channel.key;
}

/** Channels for the current source and filters, with everything unplayable left out. */
function visible(): { playlistId: string; channel: Channel }[] {
  const items: { playlistId: string; channel: Channel }[] = [];
  const pools = state.source === FAVORITES ? sourcePlaylists() : sourcePlaylists().filter((p) => p.id === state.source);
  const q = state.query.trim().toLowerCase();
  for (const p of pools) {
    for (const c of p.channels) {
      const id = favoriteId(p.id, c.key);
      if (state.dead[id] || webRoutes(c).length === 0) continue;
      if (state.source === FAVORITES && !state.favorites.has(id)) continue;
      if (state.group && c.group !== state.group) continue;
      if (state.country && c.country !== state.country) continue;
      if (q && !c.name.toLowerCase().includes(q) && !categoryName(c.group).toLowerCase().includes(q)) continue;
      items.push({ playlistId: p.id, channel: c });
    }
  }
  return items;
}

// ---------------------------------------------------------------- rendering

function renderBar(): void {
  const chip = (id: string, label: string) =>
    `<button type="button" role="tab" data-source="${esc(id)}" aria-selected="${state.source === id}">${esc(label)}</button>`;
  els.sources.innerHTML =
    chip(FREE, t("free_channels")) +
    state.vod.map((v) => chip(VOD + v.id, t(`vod_${v.id}`))).join("") +
    chip(FAVORITES, `★ ${t("favorites")}`) +
    state.playlists.map((p) => chip(p.id, p.name)).join("") +
    `<button type="button" class="dw-add" data-action="add">+ ${t("add_playlist")}</button>`;
  els.remove.hidden = !state.playlists.some((p) => p.id === state.source);
  if (isVod(state.source)) {
    const section = state.vod.find((v) => VOD + v.id === state.source);
    const channels = [...new Set((section?.items ?? []).map((i) => i.channel).filter(Boolean) as string[])];
    els.country.hidden = true;
    els.groups.innerHTML = channels.length < 2 ? "" :
      `<button type="button" data-group="" aria-pressed="${state.group === ""}">${esc(t("all"))}</button>` +
      channels.map((g) => `<button type="button" data-group="${esc(g)}" aria-pressed="${state.group === g}">${esc(g)}</button>`).join("");
    return;
  }

  const pools = state.source === FAVORITES ? sourcePlaylists() : sourcePlaylists().filter((p) => p.id === state.source);
  const channels = pools.flatMap((p) => p.channels.filter((c) => !state.dead[favoriteId(p.id, c.key)] && webRoutes(c).length));
  const countries = [...new Set(channels.map((c) => c.country).filter(Boolean) as string[])]
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  els.country.hidden = countries.length < 2;
  els.country.innerHTML =
    `<option value="">${esc(t("all_countries"))}</option>` +
    countries.map((c) => `<option value="${c.code}"${c.code === state.country ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  const groups = groupsOf(channels.filter((c) => !state.country || c.country === state.country));
  els.groups.innerHTML = groups.length < 2 ? "" :
    `<button type="button" data-group="" aria-pressed="${state.group === ""}">${esc(t("all"))}</button>` +
    groups.map((g) => `<button type="button" data-group="${esc(g)}" aria-pressed="${state.group === g}">${esc(categoryName(g))}</button>`).join("");
}

function renderGrid(): void {
  wall.clear();
  renderedOwners = new WeakMap();
  if (isVod(state.source)) {
    const section = state.vod.find((v) => VOD + v.id === state.source);
    const items = section ? vodItems(section, state.group, state.query) : [];
    els.count.textContent = t("videos_count", { count: items.length });
    els.empty.hidden = true;
    els.rows.hidden = true;
    els.rows.innerHTML = "";
    els.grid.hidden = false;
    els.grid.innerHTML = items.slice(0, state.shown).map((i) => vodTile(i, esc)).join("");
    els.more.hidden = items.length <= state.shown;
    return;
  }
  const items = visible();
  els.count.textContent = state.free || state.playlists.length ? t("channels_count", { count: items.length }) : t("loading");
  els.empty.hidden = items.length > 0 || (state.source === FREE && !state.free);
  els.grid.innerHTML = "";
  // The free channels home view (no filter, no search) is laid out as rows; anything narrower is a grid.
  const rowsView = state.source === FREE && !state.group && !state.country && !state.query.trim() && items.length > 0;
  els.rows.hidden = !rowsView;
  els.grid.hidden = rowsView;
  if (rowsView) {
    renderRows(items);
    els.more.hidden = true;
    return;
  }
  els.rows.innerHTML = "";
  appendTiles(items, 0, Math.min(state.shown, items.length));
  els.more.hidden = items.length <= state.shown;
}

/** Rows: recently watched, favorites, then one row per category, largest first. */
function renderRows(items: { playlistId: string; channel: Channel }[]): void {
  els.rows.innerHTML = "";
  const addRow = (title: string, fill: (list: HTMLUListElement) => void, group?: string, count?: number) => {
    const section = document.createElement("section");
    section.className = "dw-row";
    section.innerHTML = `<div class="dw-row-head"><h2>${esc(title)}${count !== undefined ? ` <span class="dw-n">${count}</span>` : ""}</h2>${
      group !== undefined ? `<button type="button" class="dw-link" data-group="${esc(group)}">${esc(t("see_all"))} →</button>` : ""}</div><ul class="dw-row-list"></ul>`;
    els.rows.appendChild(section);
    fill(section.querySelector("ul")!);
  };

  const recent = resolveHistory();
  if (recent.length) {
    addRow(t("recent_title"), (list) => {
      for (const r of recent) {
        if ("vod" in r) list.insertAdjacentHTML("beforeend", vodTile(r.vod, esc));
        else appendTiles([r], 0, 1, list);
      }
    });
  }
  const favorites = items.filter((x) => state.favorites.has(favoriteId(x.playlistId, x.channel.key)));
  if (favorites.length) addRow(`★ ${t("favorites")}`, (list) => appendTiles(favorites, 0, ROW_SIZE, list), undefined, favorites.length);

  const byGroup = new Map<string, { playlistId: string; channel: Channel }[]>();
  for (const x of items) {
    if (!x.channel.group) continue;
    const list = byGroup.get(x.channel.group) ?? [];
    list.push(x);
    byGroup.set(x.channel.group, list);
  }
  [...byGroup.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, ROW_COUNT)
    .forEach(([group, list]) => addRow(categoryName(group), (ul) => appendTiles(list, 0, ROW_SIZE, ul), group, list.length));
}

function resolveHistory(): ({ playlistId: string; channel: Channel } | { vod: VodItem })[] {
  const out: ({ playlistId: string; channel: Channel } | { vod: VodItem })[] = [];
  for (const h of state.history) {
    if (h.k === "vod") {
      const vod = state.vod.flatMap((v) => v.items).find((i) => i.id === h.id);
      if (vod) out.push({ vod });
    } else {
      const channel = playlistById(h.p)?.channels.find((c) => c.key === h.c);
      if (channel && !state.dead[favoriteId(h.p, h.c)] && webRoutes(channel).length) out.push({ playlistId: h.p, channel });
    }
    if (out.length >= ROW_SIZE) break;
  }
  return out;
}

function remember(entry: HistoryEntry): void {
  const same = (h: HistoryEntry) => (h.k === "vod" && entry.k === "vod" ? h.id === entry.id : h.k === "live" && entry.k === "live" && h.p === entry.p && h.c === entry.c);
  state.history = [entry, ...state.history.filter((h) => !same(h))].slice(0, HISTORY_MAX);
  writePref("history", state.history);
}

function appendTiles(items: { playlistId: string; channel: Channel }[], from: number, to: number, target: HTMLElement = els.grid): void {
  const frag = document.createDocumentFragment();
  for (const { playlistId, channel } of items.slice(from, to)) {
    const li = document.createElement("li");
    li.className = "dw-tile";
    const fav = state.favorites.has(favoriteId(playlistId, channel.key));
    li.innerHTML = `<button type="button" class="dw-tile-btn" data-key="${esc(channel.key)}" data-owner="${esc(playlistId)}">
      <span class="dw-tile-media">
        <span class="dw-tile-logo">${channel.logo ? `<img src="${esc(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${esc(channel.name.slice(0, 2))}</b></span>
        <span class="dw-live" aria-hidden="true">LIVE</span>
      </span>
      <span class="dw-tile-name">${fav ? "★ " : ""}${esc(channel.name)}</span>
      <span class="dw-tile-meta">${esc([channel.country ? countryName(channel.country) : "", categoryName(channel.group)].filter(Boolean).join(" · "))}</span>
    </button>`;
    renderedOwners.set(li, playlistId);
    frag.appendChild(li);
    wall.add(li, channel);
  }
  target.appendChild(frag);
}

function render(): void {
  state.shown = PAGE_SIZE;
  renderBar();
  renderGrid();
}

function renderTheater(): void {
  const p = state.playing;
  if (!p) return;
  const fav = state.favorites.has(favoriteId(p.playlistId, p.channel.key));
  els.nowName.textContent = p.channel.name;
  els.nowGroup.textContent = [p.channel.country ? countryName(p.channel.country) : "", categoryName(p.channel.group)].filter(Boolean).join(" · ");
  els.favorite.textContent = fav ? `★ ${t("favorite_remove")}` : `☆ ${t("favorite_add")}`;
  els.favorite.setAttribute("aria-pressed", String(fav));
  els.pip.hidden = !document.pictureInPictureEnabled;
}

function renderRoutes(activeIndex: number): void {
  const c = state.playing?.channel;
  const usable = c ? webRoutes(c) : [];
  els.routes.innerHTML = usable.length < 2 ? "" : usable
    .map((i, n) => `<button type="button" data-route="${i}"${i === activeIndex ? ' aria-pressed="true"' : ""}>${esc(t("route", { n: n + 1 }))}${c!.routes[i].label && c!.routes[i].label !== String(i + 1) ? ` · ${esc(c!.routes[i].label)}` : ""}</button>`)
    .join("");
}

// ---------------------------------------------------------------- actions

function markDead(playlistId: string, channel: Channel): void {
  state.dead[favoriteId(playlistId, channel.key)] = Date.now();
  writePref("dead", state.dead);
}

function hide(playlistId: string, channel: Channel, el: HTMLElement): void {
  markDead(playlistId, channel);
  el.remove();
  els.count.textContent = t("channels_count", { count: visible().length });
}

function selectSource(id: string): void {
  state.source = id;
  state.group = "";
  state.country = "";
  writePref("source", id);
  render();
}

/** The link that reopens what is playing: free channels and on-demand items only (a visitor's own
 *  playlists live in their browser, so their channels cannot be shared). */
function shareUrl(): string | null {
  const base = `${location.origin}${location.pathname}`;
  if (state.vodPlaying) return `${base}?vod=${encodeURIComponent(state.vodPlaying.id)}`;
  if (state.playing?.playlistId === FREE) return `${base}?channel=${encodeURIComponent(state.playing.channel.key.split("@")[0])}`;
  return null;
}

function syncAddress(): void {
  const url = shareUrl();
  history.replaceState(null, "", url ?? location.pathname);
  els.share.hidden = !url;
}

async function share(): Promise<void> {
  const url = shareUrl();
  if (!url) return;
  const title = state.vodPlaying?.title ?? state.playing?.channel.name ?? document.title;
  track("web_share", { kind: state.vodPlaying ? "vod" : "live" });
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      /* cancelled or unsupported: fall back to copying */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    els.share.textContent = `✓ ${t("link_copied")}`;
    setTimeout(() => (els.share.textContent = `↗ ${t("share")}`), 1800);
  } catch {
    prompt(t("share"), url);
  }
}

function setTheaterMode(vod: VodItem | null): void {
  state.vodPlaying = vod;
  const embed = !!vod?.video;
  els.video.hidden = embed;
  els.embed.hidden = !embed;
  if (!embed) els.embed.innerHTML = "";
  for (const b of [els.prev, els.next, els.favorite]) b.hidden = !!vod;
  els.pip.hidden = embed || !document.pictureInPictureEnabled;
  els.fullscreen.hidden = embed;
  els.attrib.hidden = !vod;
  els.routes.innerHTML = "";
}

/** On-demand items: Internet Archive films play in our player; YouTube videos in YouTube's embed. */
function openVod(item: VodItem): void {
  wall.pause();
  player.stop();
  state.playing = null;
  setTheaterMode(item);
  els.appHint.hidden = true;
  els.theater.hidden = false;
  document.body.classList.add("dw-theater-open");
  els.nowName.textContent = item.title;
  els.nowGroup.textContent = item.channel ?? item.year ?? "";
  if (item.video) {
    els.embed.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.video)}?autoplay=1&rel=0&playsinline=1" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    els.attrib.innerHTML = `${esc(t("vod_from_youtube", { channel: item.channel ?? "" }))} · <a href="https://www.youtube.com/watch?v=${encodeURIComponent(item.video)}" target="_blank" rel="noopener">${esc(t("open_on_youtube"))}</a>`;
  } else if (item.src) {
    const licence = /publicdomain/.test(item.licence ?? "") ? t("licence_pd") : t("licence_cc");
    els.attrib.innerHTML = `${esc(licence)} · <a href="${esc(item.page ?? "")}" target="_blank" rel="noopener">${esc(t("open_on_archive"))}</a>`;
    player.play({ key: item.id, name: item.title, group: "", routes: [{ url: item.src, label: "" }] });
  }
  remember({ k: "vod", id: item.id, at: Date.now() });
  syncAddress();
  track("web_vod_play", { section: item.kind ?? "", source: item.video ? "youtube" : "archive" });
}

function open(playlistId: string, channel: Channel): void {
  setTheaterMode(null);
  wall.pause();
  state.playing = { playlistId, channel };
  els.appHint.hidden = true;
  els.theater.hidden = false;
  document.body.classList.add("dw-theater-open");
  renderTheater();
  player.play(channel, liveRoute.get(favoriteId(playlistId, channel.key)) ?? webRoutes(channel)[0] ?? 0);
  remember({ k: "live", p: playlistId, c: channel.key, at: Date.now() });
  syncAddress();
  track("web_play", { channel_group: channel.group || "(none)", source: playlistId === FREE ? "free" : "own" });
}

function close(): void {
  player.stop();
  history.replaceState(null, "", location.pathname);
  if (state.vodPlaying) {
    setTheaterMode(null);
    els.theater.hidden = true;
    document.body.classList.remove("dw-theater-open");
    if (!els.rows.hidden) renderGrid();
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  els.theater.hidden = true;
  document.body.classList.remove("dw-theater-open");
  const wasDead = state.playing && state.dead[favoriteId(state.playing.playlistId, state.playing.channel.key)];
  state.playing = null;
  if (wasDead || !els.rows.hidden) renderGrid();
  else wall.resume();
}

function step(delta: number): void {
  const items = visible();
  if (!items.length || !state.playing) return;
  const i = items.findIndex((x) => x.channel === state.playing!.channel);
  const next = items[(i + delta + items.length) % items.length];
  open(next.playlistId, next.channel);
}

function toggleFavorite(): void {
  const p = state.playing;
  if (!p) return;
  const id = favoriteId(p.playlistId, p.channel.key);
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  writePref("favorites", [...state.favorites]);
  renderTheater();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

/** The free directory: the iptv-playlists index, narrowed to streams verified to play on doubo.tv. */
async function loadFree(): Promise<void> {
  try {
    const [text, playable] = await Promise.all([
      fetchText(config.freePlaylistUrl),
      fetch(config.playableUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const allowed: Set<string> | null = playable?.hashes ? new Set(playable.hashes) : null;
    const channels = parseM3U(text)
      .map((c) => ({ ...c, routes: allowed ? c.routes.filter((r) => allowed.has(fnv1a(r.url))) : c.routes }))
      .filter((c) => c.routes.length > 0);
    state.free = { id: FREE, name: t("free_channels"), source: { kind: "url", url: config.freePlaylistUrl }, channels, importedAt: 0 };
  } catch {
    state.free = { id: FREE, name: t("free_channels"), source: { kind: "url" }, channels: [], importedAt: 0 };
  }
}

async function addPlaylist(text: string, name: string, source: PlaylistSource): Promise<Playlist | null> {
  const channels = parseM3U(text);
  if (!channels.length) return null;
  const playlist: Playlist = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name || source.url?.split("/").pop()?.replace(/\.m3u8?$/i, "") || t("my_playlist"),
    source,
    channels,
    importedAt: Date.now(),
  };
  await savePlaylist(playlist);
  state.playlists.push(playlist);
  track("web_playlist_add", { source: source.kind, channels: channels.length });
  return playlist;
}

async function submitForm(): Promise<void> {
  const data = new FormData(els.form);
  const url = String(data.get("url") ?? "").trim();
  const name = String(data.get("name") ?? "").trim();
  const file = data.get("file") as File | null;
  const pasted = String(data.get("text") ?? "").trim();
  els.formMsg.textContent = t("loading");
  let playlist: Playlist | null = null;
  try {
    if (file && file.size) playlist = await addPlaylist(await file.text(), name || file.name.replace(/\.m3u8?$/i, ""), { kind: "file" });
    else if (pasted) playlist = await addPlaylist(pasted, name, { kind: "text" });
    else if (url) playlist = await addPlaylist(await fetchText(url), name, { kind: "url", url });
    else {
      els.formMsg.textContent = t("need_input");
      return;
    }
  } catch {
    els.formMsg.textContent = t("url_blocked");
    return;
  }
  if (!playlist) {
    els.formMsg.textContent = t("no_channels");
    return;
  }
  els.form.reset();
  els.formMsg.textContent = "";
  els.dialog.close();
  selectSource(playlist.id);
}

function openDialog(url = ""): void {
  els.form.reset();
  els.formMsg.textContent = "";
  (els.form.elements.namedItem("url") as HTMLInputElement).value = url;
  els.dialog.showModal();
}

/** ?channel=<tvg-id> opens a free channel; ?country=MY preselects a country in the free directory;
 *  ?add=<https url>&name= imports a playlist. */
async function applyQuery(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const country = params.get("country");
  const url = params.get("add");
  const channelId = params.get("channel");
  const vodId = params.get("vod");
  if (country || url || channelId || vodId) history.replaceState(null, "", location.pathname);
  if (vodId) {
    const item = state.vod.flatMap((v) => v.items).find((i) => i.id === vodId);
    if (item) openVod(item);
  }
  if (channelId && state.free) {
    // Channel pages link here: open that channel (any of its feeds) straight away.
    const match = state.free.channels.find((c) => c.key === channelId || c.key.startsWith(`${channelId}@`));
    if (match && !state.dead[favoriteId(FREE, match.key)]) open(FREE, match);
  }
  if (country) {
    state.source = FREE;
    render();
    state.country = country.toUpperCase() === "UK" ? "GB" : country.toUpperCase();
    renderBar();
    renderGrid();
  }
  if (url && /^https:\/\//.test(url)) {
    const existing = state.playlists.find((p) => p.source.url === url);
    if (existing) return selectSource(existing.id);
    try {
      const playlist = await addPlaylist(await fetchText(url), params.get("name") ?? "", { kind: "url", url });
      if (playlist) selectSource(playlist.id);
    } catch {
      openDialog(url);
    }
  }
}

// ---------------------------------------------------------------- events

root.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "add") openDialog();
  else if (action === "cancel") els.dialog.close();
  else if (action === "close") close();
  else if (action === "prev") step(-1);
  else if (action === "next") step(1);
  else if (action === "favorite") toggleFavorite();
  else if (action === "share") share();
  else if (action === "pip") {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await els.video.requestPictureInPicture().catch(() => undefined);
  } else if (action === "fullscreen") els.video.requestFullscreen?.().catch(() => undefined);
  else if (action === "more" && isVod(state.source)) {
    state.shown += PAGE_SIZE;
    renderGrid();
  } else if (action === "more") {
    const items = visible();
    appendTiles(items, state.shown, Math.min(state.shown + PAGE_SIZE, items.length));
    state.shown += PAGE_SIZE;
    els.more.hidden = items.length <= state.shown;
  } else if (action === "remove") {
    const p = state.playlists.find((x) => x.id === state.source);
    if (p && confirm(t("confirm_remove", { name: p.name }))) {
      await deletePlaylist(p.id);
      state.playlists = state.playlists.filter((x) => x.id !== p.id);
      selectSource(FREE);
    }
  }

  const source = target.closest<HTMLElement>("[data-source]")?.dataset.source;
  if (source !== undefined) selectSource(source);
  const group = target.closest<HTMLElement>("[data-group]")?.dataset.group;
  if (group !== undefined) {
    state.group = group;
    state.shown = PAGE_SIZE;
    renderBar();
    renderGrid();
  }
  const vodTarget = target.closest<HTMLElement>("[data-vod]");
  if (vodTarget) {
    const item = state.vod.flatMap((v) => v.items).find((i) => i.id === vodTarget.dataset.vod);
    if (item) openVod(item);
  }
  const tile = target.closest<HTMLElement>("[data-key]");
  if (tile) {
    const p = playlistById(tile.dataset.owner!);
    const channel = p?.channels.find((c) => c.key === tile.dataset.key);
    if (p && channel) open(p.id, channel);
  }
  const route = target.closest<HTMLElement>("[data-route]")?.dataset.route;
  if (route !== undefined) {
    els.appHint.hidden = true;
    player.switchRoute(Number(route));
  }
});

els.country.addEventListener("change", () => {
  state.country = els.country.value;
  state.group = "";
  state.shown = PAGE_SIZE;
  renderBar();
  renderGrid();
});
let searchTimer = 0;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = els.search.value;
    state.shown = PAGE_SIZE;
    renderGrid();
  }, 200);
});
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm();
});

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select") || els.dialog.open) return;
  const theater = !els.theater.hidden;
  if (e.key === "Escape" && theater && !document.fullscreenElement) close();
  else if (e.key === "/" && !theater) { e.preventDefault(); els.search.focus(); }
  else if (!theater) return;
  else if (state.vodPlaying) return;
  else if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  else if (e.key.toLowerCase() === "f") els.video.requestFullscreen?.().catch(() => undefined);
  else if (e.key.toLowerCase() === "p" && document.pictureInPictureEnabled) els.pip.click();
  else if (e.key.toLowerCase() === "m") els.video.muted = !els.video.muted;
});

// ---------------------------------------------------------------- start

(async () => {
  state.playlists = await loadPlaylists();
  if (state.source !== FREE && state.source !== FAVORITES && !isVod(state.source) && !state.playlists.some((p) => p.id === state.source)) state.source = FREE;
  renderBar();
  renderGrid();
  [, state.vod] = await Promise.all([loadFree(), loadVod(config.vodUrl)]);
  if (isVod(state.source) && !state.vod.some((v) => VOD + v.id === state.source)) state.source = FREE;
  render();
  await applyQuery();
})();
