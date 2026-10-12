import type Hls from "hls.js";
import type { Channel } from "./model";
import { routeLimit } from "./model";

const START_TIMEOUT_MS = 15000;

/** Plays a channel, moving to the next route on its own when one does not start.
 *  Calls onExhausted when no route of the channel can be played in this browser. */
export class Player {
  private hls: Hls | null = null;
  private timer = 0;
  private channel: Channel | null = null;
  private routeIndex = 0;
  private tried = new Set<number>();

  constructor(
    private video: HTMLVideoElement,
    private onRoute: (index: number) => void,
    private onExhausted: () => void,
  ) {
    video.addEventListener("playing", () => clearTimeout(this.timer));
    video.addEventListener("error", () => this.next());
  }

  get current(): { channel: Channel | null; routeIndex: number } {
    return { channel: this.channel, routeIndex: this.routeIndex };
  }

  play(channel: Channel, routeIndex = 0): void {
    this.channel = channel;
    this.tried = new Set();
    this.start(routeIndex);
  }

  /** Switch route on request; unlike automatic fallback this may revisit routes. */
  switchRoute(index: number): void {
    if (!this.channel) return;
    this.tried.delete(index);
    this.start(index);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.hls?.destroy();
    this.hls = null;
    this.video.removeAttribute("src");
    this.video.load();
  }

  private playableIndex(from: number): number {
    const routes = this.channel?.routes ?? [];
    for (let step = 0; step < routes.length; step++) {
      const i = (from + step) % routes.length;
      if (!this.tried.has(i) && routeLimit(routes[i], location.protocol === "https:") === null) return i;
    }
    return -1;
  }

  private next(): void {
    if (!this.channel) return;
    const i = this.playableIndex(this.routeIndex + 1);
    if (i < 0) {
      this.stop();
      this.onExhausted();
    } else {
      this.start(i);
    }
  }

  private async start(from: number): Promise<void> {
    const channel = this.channel!;
    const index = this.playableIndex(from);
    this.stop();
    if (index < 0) return this.onExhausted();
    this.routeIndex = index;
    this.tried.add(index);
    this.onRoute(index);
    const url = channel.routes[index].url;
    this.timer = window.setTimeout(() => this.next(), START_TIMEOUT_MS);

    const nativeHls = this.video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const isHls = /\.m3u8?(\?|$)/i.test(url) || !/\.(mp4|webm|ts)(\?|$)/i.test(url);
    if (!isHls || nativeHls) {
      this.video.src = url;
    } else {
      const { default: HlsClass } = await import("hls.js");
      if (this.channel !== channel || this.routeIndex !== index) return; // user moved on meanwhile
      if (!HlsClass.isSupported()) {
        this.video.src = url;
      } else {
        const hls = new HlsClass({ lowLatencyMode: true, backBufferLength: 30 });
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (data.fatal) this.next();
        });
        hls.loadSource(url);
        hls.attachMedia(this.video);
        this.hls = hls;
      }
    }
    this.video.play().catch(() => {
      /* autoplay with sound can be refused; the user presses play */
    });
  }
}
