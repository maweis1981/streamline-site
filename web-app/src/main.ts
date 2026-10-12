import "./styles.css";
import { config, t, track } from "./i18n";
import { groupsOf, parseM3U } from "./m3u";
import type { Channel, Playlist, PlaylistSource } from "./model";
import { favoriteId } from "./model";
import { Player } from "./player";
import { deletePlaylist, loadPlaylists, readPref, savePlaylist, writePref } from "./store";

const ALL = "__doubo_all__"; // sentinels must survive HTML attributes (no control characters)
const FAVORITES = "__doubo_favorites__";
const MAX_ROWS = 400; // the list renders the first matches; search narrows the rest

interface State {
  playlists: Playlist[];
  playlistId: string | null;
  group: string;
  query: string;
  favorites: Set<string>;
  playing: Channel | null;
}

const state: State = {
  playlists: [],
  playlistId: readPref<string | null>("playlist", null),
  group: ALL,
  query: "",
  favorites: new Set(readPref<string[]>("favorites", [])),
  playing: null,
};

const root = document.getElementById("doubo-web")!;
root.innerHTML = `
  <div class="dw">
    <aside class="dw-side">
      <div class="dw-side-head">
        <select class="dw-playlist" aria-label="${t("playlists")}"></select>
        <button type="button" class="dw-icon-btn" data-action="add" title="${t("add_playlist")}" aria-label="${t("add_playlist")}">+</button>
      </div>
      <nav class="dw-groups" aria-label="${t("groups")}"></nav>
      <button type="button" class="dw-link dw-remove" data-action="remove">${t("remove_playlist")}</button>
    </aside>
    <section class="dw-list">
      <input class="dw-search" type="search" placeholder="${t("search")}" aria-label="${t("search")}">
      <p class="dw-count"></p>
      <ul class="dw-channels" role="listbox" aria-label="${t("channels")}"></ul>
    </section>
    <section class="dw-stage">
      <div class="dw-video-wrap">
        <video class="dw-video" controls playsinline></video>
        <div class="dw-overlay dw-placeholder"><p>${t("select_channel")}</p></div>
        <div class="dw-overlay dw-app-hint" hidden>
          <h2>${t("app_hint_title")}</h2>
          <p>${t("app_hint_desc")}</p>
          <a class="dw-btn dw-btn-primary" href="${config.appUrl}" data-track="cta_click" data-track-target="download_anchor" data-track-location="web_player">${t("open_app")}</a>
        </div>
      </div>
      <div class="dw-now">
        <div class="dw-now-title"><h1 class="dw-now-name"></h1><span class="dw-now-group"></span></div>
        <div class="dw-now-actions">
          <button type="button" class="dw-btn" data-action="favorite" hidden></button>
          <button type="button" class="dw-btn" data-action="pip" hidden>${t("pip")}</button>
          <button type="button" class="dw-btn" data-action="fullscreen" hidden>${t("fullscreen")}</button>
        </div>
      </div>
      <div class="dw-routes" role="group" aria-label="${t("routes")}"></div>
      <p class="dw-hint">${t("shortcuts")}</p>
    </section>
    <div class="dw-empty" hidden>
      <h2>${t("empty_title")}</h2>
      <p>${t("empty_desc")}</p>
      <div class="dw-empty-actions">
        <button type="button" class="dw-btn dw-btn-primary" data-action="add">${t("add_playlist")}</button>
        <a class="dw-btn" href="${config.directoryUrl}">${t("browse_directory")}</a>
      </div>
      <p class="dw-note">${t("privacy_note")}</p>
    </div>
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
  shell: $<HTMLDivElement>(".dw"),
  playlist: $<HTMLSelectElement>(".dw-playlist"),
  groups: $<HTMLElement>(".dw-groups"),
  search: $<HTMLInputElement>(".dw-search"),
  count: $<HTMLParagraphElement>(".dw-count"),
  channels: $<HTMLUListElement>(".dw-channels"),
  video: $<HTMLVideoElement>(".dw-video"),
  placeholder: $<HTMLDivElement>(".dw-placeholder"),
  appHint: $<HTMLDivElement>(".dw-app-hint"),
  nowName: $<HTMLHeadingElement>(".dw-now-name"),
  nowGroup: $<HTMLSpanElement>(".dw-now-group"),
  favorite: $<HTMLButtonElement>('[data-action="favorite"]'),
  pip: $<HTMLButtonElement>('[data-action="pip"]'),
  fullscreen: $<HTMLButtonElement>('[data-action="fullscreen"]'),
  routes: $<HTMLDivElement>(".dw-routes"),
  empty: $<HTMLDivElement>(".dw-empty"),
  dialog: $<HTMLDialogElement>(".dw-dialog"),
  form: $<HTMLFormElement>(".dw-form"),
  formMsg: $<HTMLParagraphElement>(".dw-form-msg"),
};

const player = new Player(
  els.video,
  (index) => renderRoutes(index),
  () => {
    els.appHint.hidden = false;
    track("web_play_unavailable");
  },
);

// ---------------------------------------------------------------- helpers

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function current(): Playlist | undefined {
  return state.playlists.find((p) => p.id === state.playlistId);
}

function visibleChannels(p: Playlist): Channel[] {
  const q = state.query.trim().toLowerCase();
  return p.channels.filter((c) => {
    if (state.group === FAVORITES && !state.favorites.has(favoriteId(p.id, c.key))) return false;
    if (state.group !== ALL && state.group !== FAVORITES && c.group !== state.group) return false;
    return !q || c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q);
  });
}

// ---------------------------------------------------------------- rendering

function render(): void {
  const p = current();
  els.empty.hidden = !!p;
  els.shell.classList.toggle("is-empty", !p);
  els.playlist.innerHTML = state.playlists
    .map((pl) => `<option value="${esc(pl.id)}"${pl.id === state.playlistId ? " selected" : ""}>${esc(pl.name)}</option>`)
    .join("");
  if (!p) return;

  const groups = groupsOf(p.channels);
  const favCount = p.channels.filter((c) => state.favorites.has(favoriteId(p.id, c.key))).length;
  const groupItem = (id: string, label: string, n: number) =>
    `<button type="button" data-group="${esc(id)}"${state.group === id ? ' aria-current="true"' : ""}><span>${esc(label)}</span><span class="dw-n">${n}</span></button>`;
  els.groups.innerHTML =
    groupItem(ALL, t("all"), p.channels.length) +
    groupItem(FAVORITES, t("favorites"), favCount) +
    groups.map((g) => groupItem(g, g, p.channels.filter((c) => c.group === g).length)).join("");
  renderChannels();
}

function renderChannels(): void {
  const p = current();
  if (!p) return;
  const list = visibleChannels(p);
  els.count.textContent = t("channels_count", { count: list.length });
  els.channels.innerHTML = list
    .slice(0, MAX_ROWS)
    .map((c) => {
      const active = state.playing?.key === c.key;
      const fav = state.favorites.has(favoriteId(p.id, c.key));
      const logo = c.logo
        ? `<img src="${esc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
        : "";
      return `<li role="option" tabindex="-1" data-key="${esc(c.key)}"${active ? ' aria-selected="true"' : ""}>
        <span class="dw-logo">${logo}<b>${esc(c.name.slice(0, 1))}</b></span>
        <span class="dw-ch-name">${esc(c.name)}</span>${fav ? '<span class="dw-star" aria-hidden="true">★</span>' : ""}</li>`;
    })
    .join("");
}

function renderNowPlaying(): void {
  const p = current();
  const c = state.playing;
  els.placeholder.hidden = !!c;
  els.nowName.textContent = c?.name ?? "";
  els.nowGroup.textContent = c?.group ?? "";
  els.favorite.hidden = !c;
  els.pip.hidden = !c || !document.pictureInPictureEnabled;
  els.fullscreen.hidden = !c;
  if (c && p) {
    const fav = state.favorites.has(favoriteId(p.id, c.key));
    els.favorite.textContent = fav ? `★ ${t("favorite_remove")}` : `☆ ${t("favorite_add")}`;
    els.favorite.setAttribute("aria-pressed", String(fav));
  }
}

function renderRoutes(activeIndex: number): void {
  const c = state.playing;
  if (!c || c.routes.length < 2) {
    els.routes.innerHTML = "";
    return;
  }
  els.routes.innerHTML = c.routes
    .map((r, i) => `<button type="button" data-route="${i}"${i === activeIndex ? ' aria-pressed="true"' : ""}>${esc(t("route", { n: i + 1 }))}${r.label && r.label !== String(i + 1) ? ` · ${esc(r.label)}` : ""}</button>`)
    .join("");
}

// ---------------------------------------------------------------- actions

function selectPlaylist(id: string | null): void {
  state.playlistId = id;
  state.group = ALL;
  writePref("playlist", id);
  render();
}

function play(c: Channel): void {
  state.playing = c;
  els.appHint.hidden = true;
  renderNowPlaying();
  renderChannels();
  player.play(c);
  track("web_play", { channel_group: c.group || "(none)" });
}

function step(delta: number): void {
  const p = current();
  if (!p) return;
  const list = visibleChannels(p).slice(0, MAX_ROWS);
  if (!list.length) return;
  const i = list.findIndex((c) => c.key === state.playing?.key);
  const next = list[(i + delta + list.length) % list.length];
  play(next);
  els.channels.querySelector(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" });
}

function toggleFavorite(): void {
  const p = current();
  const c = state.playing;
  if (!p || !c) return;
  const id = favoriteId(p.id, c.key);
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  writePref("favorites", [...state.favorites]);
  renderNowPlaying();
  render();
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
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
  selectPlaylist(playlist.id);
}

/** Links like /web/?add=<m3u url>&name=<label> (used by the channel directory) import once, then reuse. */
async function importFromQuery(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const url = params.get("add");
  if (!url || !/^https:\/\//.test(url)) return;
  history.replaceState(null, "", location.pathname);
  const existing = state.playlists.find((p) => p.source.url === url);
  if (existing) return selectPlaylist(existing.id);
  try {
    const playlist = await addPlaylist(await fetchText(url), params.get("name") ?? "", { kind: "url", url });
    if (playlist) selectPlaylist(playlist.id);
  } catch {
    openDialog(url);
  }
}

function openDialog(url = ""): void {
  els.form.reset();
  els.formMsg.textContent = "";
  (els.form.elements.namedItem("url") as HTMLInputElement).value = url;
  els.dialog.showModal();
}

// ---------------------------------------------------------------- events

root.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "add") openDialog();
  if (action === "cancel") els.dialog.close();
  if (action === "favorite") toggleFavorite();
  if (action === "pip") {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await els.video.requestPictureInPicture().catch(() => undefined);
  }
  if (action === "fullscreen") els.video.requestFullscreen?.().catch(() => undefined);
  if (action === "remove") {
    const p = current();
    if (p && confirm(t("confirm_remove", { name: p.name }))) {
      player.stop();
      state.playing = null;
      renderNowPlaying();
      await deletePlaylist(p.id);
      state.playlists = state.playlists.filter((x) => x.id !== p.id);
      selectPlaylist(state.playlists[0]?.id ?? null);
    }
  }
  const group = target.closest<HTMLElement>("[data-group]")?.dataset.group;
  if (group !== undefined) {
    state.group = group;
    render();
  }
  const key = target.closest<HTMLElement>("[data-key]")?.dataset.key;
  const channel = key !== undefined ? current()?.channels.find((c) => c.key === key) : undefined;
  if (channel) play(channel);
  const route = target.closest<HTMLElement>("[data-route]")?.dataset.route;
  if (route !== undefined) {
    els.appHint.hidden = true;
    player.switchRoute(Number(route));
  }
});

els.playlist.addEventListener("change", () => selectPlaylist(els.playlist.value));
els.search.addEventListener("input", () => {
  state.query = els.search.value;
  renderChannels();
});
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  submitForm();
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, select") || els.dialog.open;
  if (typing) return;
  if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  else if (e.key === "/") { e.preventDefault(); els.search.focus(); }
  else if (e.key.toLowerCase() === "f" && state.playing) els.video.requestFullscreen?.().catch(() => undefined);
  else if (e.key.toLowerCase() === "p" && state.playing && document.pictureInPictureEnabled) els.pip.click();
  else if (e.key.toLowerCase() === "m") els.video.muted = !els.video.muted;
});

// ---------------------------------------------------------------- start

(async () => {
  state.playlists = await loadPlaylists();
  if (!current()) state.playlistId = state.playlists[0]?.id ?? null;
  render();
  renderNowPlaying();
  await importFromQuery();
})();
