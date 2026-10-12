import type Hls from "hls.js";
import type { Channel } from "./model";
import { routeLimit } from "./model";

const START_TIMEOUT_MS = 12000;

let hlsModule: Promise<typeof import("hls.js")> | null = null;
export function loadHls(): Promise<typeof import("hls.js")> {
  return (hlsModule ??= import("hls.js"));
}

export function webRoutes(channel: Channel): number[] {
  const secure = location.protocol === "https:";
  return channel.routes.map((_, i) => i).filter((i) => routeLimit(channel.routes[i], secure) === null);
}

interface Tile {
  el: HTMLElement;
  channel: Channel;
  video?: HTMLVideoElement;
  hls?: Hls;
  timer?: number;
  routes: number[];
  attempt: number;
}

/** Muted live previews for the channel wall. Only tiles on screen play, and at most
 *  `limit` at a time; a tile whose routes all fail to start is reported as dead. */
export class PreviewWall {
  private tiles = new Map<HTMLElement, Tile>();
  private visible = new Set<HTMLElement>();
  private active = new Set<HTMLElement>();
  private paused = false;
  private observer: IntersectionObserver;

  constructor(
    private limit: number,
    private onLive: (channel: Channel, routeIndex: number) => void,
    private onDead: (channel: Channel, el: HTMLElement) => void,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) this.visible.add(el);
          else {
            this.visible.delete(el);
            this.stop(el);
          }
        }
        this.schedule();
      },
      { threshold: 0.4 },
    );
  }

  add(el: HTMLElement, channel: Channel): void {
    this.tiles.set(el, { el, channel, routes: webRoutes(channel), attempt: 0 });
    this.observer.observe(el);
  }

  clear(): void {
    for (const el of [...this.active]) this.stop(el);
    this.observer.disconnect();
    this.tiles.clear();
    this.visible.clear();
  }

  pause(): void {
    this.paused = true;
    for (const el of [...this.active]) this.stop(el);
  }

  resume(): void {
    this.paused = false;
    this.schedule();
  }

  private schedule(): void {
    if (this.paused || this.limit <= 0) return;
    const ordered = [...this.visible].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const el of ordered) {
      if (this.active.size >= this.limit) break;
      if (!this.active.has(el)) this.start(el);
    }
  }

  private start(el: HTMLElement): void {
    const tile = this.tiles.get(el);
    if (!tile) return;
    if (tile.attempt >= tile.routes.length) return this.dead(tile);
    this.active.add(el);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.className = "dw-tile-video";
    tile.video = video;
    el.querySelector(".dw-tile-media")!.prepend(video);

    const routeIndex = tile.routes[tile.attempt];
    const url = tile.channel.routes[routeIndex].url;
    const fail = () => {
      if (!this.active.has(el)) return;
      this.stop(el);
      tile.attempt++;
      this.start(el);
    };
    tile.timer = window.setTimeout(fail, START_TIMEOUT_MS);
    video.addEventListener("playing", () => {
      clearTimeout(tile.timer);
      el.classList.add("is-live");
      this.onLive(tile.channel, routeIndex);
    }, { once: true });
    video.addEventListener("error", fail, { once: true });

    const native = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    if (native) {
      video.src = url;
      video.play().catch(() => undefined);
      return;
    }
    loadHls().then(({ default: HlsClass }) => {
      if (tile.video !== video) return;
      if (!HlsClass.isSupported()) return this.dead(tile);
      const hls = new HlsClass({
        startLevel: 0,
        capLevelToPlayerSize: true,
        maxBufferLength: 6,
        maxMaxBufferLength: 10,
        backBufferLength: 0,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 1,
      });
      hls.on(HlsClass.Events.ERROR, (_e, data) => data.fatal && fail());
      hls.loadSource(url);
      hls.attachMedia(video);
      tile.hls = hls;
      video.play().catch(() => undefined);
    });
  }

  private stop(el: HTMLElement): void {
    const tile = this.tiles.get(el);
    this.active.delete(el);
    if (!tile) return;
    clearTimeout(tile.timer);
    tile.hls?.destroy();
    tile.hls = undefined;
    if (tile.video) {
      tile.video.removeAttribute("src");
      tile.video.load();
      tile.video.remove();
      tile.video = undefined;
    }
    el.classList.remove("is-live");
  }

  private dead(tile: Tile): void {
    this.stop(tile.el);
    this.observer.unobserve(tile.el);
    this.visible.delete(tile.el);
    this.tiles.delete(tile.el);
    this.onDead(tile.channel, tile.el);
    this.schedule();
  }
}
