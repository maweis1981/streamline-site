import "./tool.css";
import { t, track } from "./i18n";
import { parseEntries, parseM3U, serializeEntries, type RawEntry } from "./m3u";
import { savePlaylist, writePref } from "./store";

// M3U analyzer & cleaner: reads playlist text only (never opens streams), reports what is
// inside, and exports a tidied copy. Everything happens in the browser.

const root = document.getElementById("doubo-tool")!;
const webUrl = root.dataset.webUrl ?? "/web/";
root.innerHTML = `
  <form class="tl-form card gborder">
    <label>${t("input_url")}<input name="url" type="url" inputmode="url" placeholder="https://example.com/playlist.m3u"></label>
    <label>${t("input_file")}<input name="file" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"></label>
    <details><summary>${t("input_text")}</summary><textarea name="text" rows="6" spellcheck="false"></textarea></details>
    <div class="tl-actions"><button type="submit" class="btn btn-primary">${t("analyze")}</button><span class="tl-msg" role="status"></span></div>
    <p class="tl-note">${t("privacy")}</p>
  </form>
  <div class="tl-result" hidden>
    <dl class="tl-stats"></dl>
    <div class="tl-cols">
      <section class="card tl-groups"><h2>${t("groups_title")}</h2><table><thead><tr><th>${t("group_col")}</th><th>${t("channels_col")}</th></tr></thead><tbody></tbody></table></section>
      <section class="card tl-clean">
        <h2>${t("clean_title")}</h2>
        <label><input type="checkbox" name="dedupe" checked> ${t("opt_dedupe")}</label>
        <label><input type="checkbox" name="sort" checked> ${t("opt_sort")}</label>
        <label><input type="checkbox" name="https"> ${t("opt_https")}</label>
        <p class="tl-out"></p>
        <div class="tl-actions">
          <button type="button" class="btn btn-primary" data-action="download">${t("download")}</button>
          <button type="button" class="btn btn-ghost" data-action="web">${t("open_web")}</button>
        </div>
      </section>
    </div>
  </div>`;

const form = root.querySelector<HTMLFormElement>(".tl-form")!;
const msg = root.querySelector<HTMLSpanElement>(".tl-msg")!;
const result = root.querySelector<HTMLDivElement>(".tl-result")!;
const clean = root.querySelector<HTMLElement>(".tl-clean")!;
let entries: RawEntry[] = [];
let sourceName = "playlist";

const fmt = new Intl.NumberFormat(document.documentElement.lang || undefined);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const groupOf = (e: RawEntry) => (e.attrs["group-title"] ?? "").split(";")[0].trim();

function analyze(text: string): boolean {
  entries = parseEntries(text);
  if (!entries.length) return false;
  const urls = new Map<string, number>();
  for (const e of entries) urls.set(e.url, (urls.get(e.url) ?? 0) + 1);
  const duplicates = entries.length - urls.size;
  const channels = parseM3U(text);
  const groups = new Map<string, number>();
  for (const c of channels) groups.set(c.group || "—", (groups.get(c.group || "—") ?? 0) + 1);
  const pct = (n: number) => `${fmt.format(n)} <small>(${Math.round((n / entries.length) * 100)}%)</small>`;
  const stats: [string, string][] = [
    [t("stat_entries"), fmt.format(entries.length)],
    [t("stat_channels"), fmt.format(channels.length)],
    [t("stat_groups"), fmt.format(groups.size)],
    [t("stat_duplicates"), fmt.format(duplicates)],
    [t("stat_https"), pct(entries.filter((e) => e.url.startsWith("https://")).length)],
    [t("stat_logos"), pct(entries.filter((e) => e.attrs["tvg-logo"]).length)],
    [t("stat_tvgid"), pct(entries.filter((e) => e.attrs["tvg-id"]).length)],
    [t("stat_multi"), fmt.format(channels.filter((c) => c.routes.length > 1).length)],
  ];
  root.querySelector(".tl-stats")!.innerHTML = stats.map(([k, v]) => `<div class="card"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
  root.querySelector(".tl-groups tbody")!.innerHTML = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `<tr><td>${esc(g)}</td><td>${fmt.format(n)}</td></tr>`)
    .join("");
  result.hidden = false;
  updateOutput();
  track("tool_m3u_analyze", { entries: entries.length });
  return true;
}

function cleaned(): RawEntry[] {
  const opt = (name: string) => clean.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;
  let out = entries;
  if (opt("https")) out = out.filter((e) => e.url.startsWith("https://"));
  if (opt("dedupe")) {
    const seen = new Set<string>();
    out = out.filter((e) => !seen.has(e.url) && !!seen.add(e.url));
  }
  if (opt("sort")) out = [...out].sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || a.title.localeCompare(b.title));
  return out;
}

function updateOutput(): void {
  root.querySelector(".tl-out")!.textContent = `${t("stat_entries")}: ${fmt.format(entries.length)} → ${fmt.format(cleaned().length)}`;
}

async function readInput(): Promise<string | null> {
  const data = new FormData(form);
  const file = data.get("file") as File | null;
  const text = String(data.get("text") ?? "").trim();
  const url = String(data.get("url") ?? "").trim();
  if (file && file.size) {
    sourceName = file.name.replace(/\.m3u8?$/i, "");
    return file.text();
  }
  if (text) {
    sourceName = "playlist";
    return text;
  }
  if (url) {
    sourceName = url.split("/").pop()?.replace(/\.m3u8?$/i, "") || "playlist";
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = t("loading");
  try {
    const text = await readInput();
    if (text === null) return void (msg.textContent = t("need_input"));
    msg.textContent = analyze(text) ? "" : t("no_channels");
  } catch {
    msg.textContent = t("url_blocked");
  }
});

clean.addEventListener("change", updateOutput);
root.addEventListener("click", async (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "download") {
    const blob = new Blob([serializeEntries(cleaned())], { type: "audio/x-mpegurl" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${sourceName}-clean.m3u` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    track("tool_m3u_download", { entries: cleaned().length });
  }
  if (action === "web") {
    const text = serializeEntries(cleaned());
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await savePlaylist({ id, name: sourceName, source: { kind: "text" }, channels: parseM3U(text), importedAt: Date.now() });
    writePref("source", id);
    location.href = webUrl;
  }
});
