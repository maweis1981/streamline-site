import { describe, expect, it } from "vitest";
import { groupsOf, parseExtinf, parseM3U, splitTitle } from "./m3u";
import { routeLimit } from "./model";

describe("parseExtinf", () => {
  it("keeps commas inside quoted attributes out of the title", () => {
    const { attrs, title } = parseExtinf('#EXTINF:-1 tvg-id="a.b" group-title="News, World",CNN International');
    expect(attrs["group-title"]).toBe("News, World");
    expect(title).toBe("CNN International");
  });
  it("accepts titles with commas", () => {
    expect(parseExtinf("#EXTINF:-1,Hello, World").title).toBe("Hello, World");
  });
});

describe("parseM3U", () => {
  const sample = [
    "﻿#EXTM3U",
    '#EXTINF:-1 tvg-id="TV1.my@SD" tvg-logo="https://x/l.png" group-title="General",TV1 (720p)',
    "https://a.example/tv1.m3u8",
    '#EXTINF:-1 tvg-id="TV1.my@SD" group-title="General",TV1 (1080p)',
    "#EXTVLCOPT:http-referrer=https://ref.example/",
    "https://b.example/tv1.m3u8",
    "#EXTINF:-1,Local Channel",
    "#EXTGRP:Local",
    "http://c.example/local.ts",
  ].join("\r\n");

  it("merges routes for the same tvg-id", () => {
    const channels = parseM3U(sample);
    expect(channels).toHaveLength(2);
    expect(channels[0].routes.map((r) => r.url)).toEqual(["https://a.example/tv1.m3u8", "https://b.example/tv1.m3u8"]);
    expect(channels[0].routes[1].referrer).toBe("https://ref.example/");
    expect(channels[0].logo).toBe("https://x/l.png");
    expect(channels[0].name).toBe("TV1");
    expect(channels[0].routes.map((r) => r.label)).toEqual(["720p", "1080p"]);
  });
  it("reads #EXTGRP groups", () => {
    expect(groupsOf(parseM3U(sample))).toEqual(["General", "Local"]);
  });
  it("flags routes a browser cannot open", () => {
    const [tv1, local] = parseM3U(sample);
    expect(routeLimit(tv1.routes[0], true)).toBeNull();
    expect(routeLimit(tv1.routes[1], true)).toBe("headers");
    expect(routeLimit(local.routes[0], true)).toBe("insecure");
    expect(routeLimit(local.routes[0], false)).toBeNull();
  });
});

describe("splitTitle", () => {
  it("separates trailing qualifiers", () => {
    expect(splitTitle("Berita RTM (720p) [Geo-blocked]")).toEqual({ name: "Berita RTM", qualifiers: "720p · Geo-blocked" });
    expect(splitTitle("(Not) a qualifier")).toEqual({ name: "(Not) a qualifier", qualifiers: "" });
  });
});
