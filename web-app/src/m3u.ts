import type { Channel, Route } from "./model";

const UNGROUPED = "";

interface PendingEntry {
  attrs: Record<string, string>;
  title: string;
  group?: string;
  referrer?: string;
  userAgent?: string;
}

/** Split `#EXTINF:-1 key="v, with comma" key2=v2,Title` into attributes and title.
 *  The title starts after the first comma that is outside quotes. */
export function parseExtinf(line: string): { attrs: Record<string, string>; title: string } {
  const body = line.slice(line.indexOf(":") + 1);
  let inQuotes = false;
  let split = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) { split = i; break; }
  }
  const head = split >= 0 ? body.slice(0, split) : body;
  const title = split >= 0 ? body.slice(split + 1).trim() : "";
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)=("([^"]*)"|[^\s"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) attrs[m[1].toLowerCase()] = m[3] ?? m[2];
  return { attrs, title };
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

const QUALIFIERS = /\s*(\[[^\]]*\]|\([^)]*\))\s*$/;

/** "TV1 (1080p) [Geo-blocked]" -> { name: "TV1", qualifiers: "1080p · Geo-blocked" } */
export function splitTitle(title: string): { name: string; qualifiers: string } {
  let name = title.trim();
  const parts: string[] = [];
  let m: RegExpMatchArray | null;
  while ((m = name.match(QUALIFIERS)) && m.index! > 0) {
    parts.unshift(m[1].slice(1, -1).trim());
    name = name.slice(0, m.index).trim();
  }
  return { name, qualifiers: parts.join(" · ") };
}

/** Parse M3U / M3U8 playlist text into channels. Entries sharing a tvg-id (or, without one,
 *  the same name) become one channel with several routes. */
export function parseM3U(text: string): Channel[] {
  const channels = new Map<string, Channel>();
  let pending: PendingEntry | null = null;
  let currentGroup: string | undefined;

  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const { attrs, title } = parseExtinf(line);
      pending = { attrs, title: title || attrs["tvg-name"] || "" };
      currentGroup = undefined;
    } else if (line.startsWith("#EXTGRP:")) {
      currentGroup = line.slice(8).trim();
      if (pending) pending.group = currentGroup;
    } else if (line.startsWith("#EXTVLCOPT:")) {
      const [key, ...rest] = line.slice(11).split("=");
      const value = rest.join("=").trim();
      if (pending && key === "http-referrer") pending.referrer = value;
      if (pending && key === "http-user-agent") pending.userAgent = value;
    } else if (!line.startsWith("#")) {
      if (!pending) continue; // bare URL lists without #EXTINF are skipped
      const title = pending.title || line;
      const { name, qualifiers } = splitTitle(title);
      const key = pending.attrs["tvg-id"] || normalize(name);
      const group = (pending.attrs["group-title"] ?? pending.group ?? UNGROUPED).split(";")[0].trim();
      let channel = channels.get(key);
      if (!channel) {
        channel = { key, name, group, logo: pending.attrs["tvg-logo"] || undefined, routes: [] };
        const country = pending.attrs["tvg-country"]?.split(";")[0].trim().toUpperCase();
        if (country) channel.country = country === "UK" ? "GB" : country;
        channels.set(key, channel);
      }
      if (!channel.routes.some((r) => r.url === line)) {
        const route: Route = { url: line, label: qualifiers || String(channel.routes.length + 1) };
        if (pending.referrer) route.referrer = pending.referrer;
        if (pending.userAgent) route.userAgent = pending.userAgent;
        channel.routes.push(route);
      }
      pending = null;
    }
  }
  return [...channels.values()];
}

export function groupsOf(channels: Channel[]): string[] {
  const seen = new Set<string>();
  for (const c of channels) if (c.group) seen.add(c.group);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export interface RawEntry {
  extinf: string;          // the original #EXTINF line
  options: string[];       // #EXTVLCOPT / #EXTGRP lines that belong to the entry
  attrs: Record<string, string>;
  title: string;
  url: string;
}

/** Entries exactly as they appear in the playlist, for tools that rewrite it. */
export function parseEntries(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let pending: Omit<RawEntry, "url"> | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const { attrs, title } = parseExtinf(line);
      pending = { extinf: line, options: [], attrs, title };
    } else if (line.startsWith("#EXTVLCOPT") || line.startsWith("#EXTGRP")) {
      pending?.options.push(line);
    } else if (!line.startsWith("#") && pending) {
      entries.push({ ...pending, url: line });
      pending = null;
    }
  }
  return entries;
}

export function serializeEntries(entries: RawEntry[]): string {
  return "#EXTM3U\n" + entries.map((e) => [e.extinf, ...e.options, e.url].join("\n")).join("\n") + "\n";
}
