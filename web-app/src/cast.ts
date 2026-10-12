// Casting from the web player.
// - Chrome / Edge: Google Cast. The Cast SDK (served by Google, as Cast requires) is loaded
//   only when the visitor presses Cast, then the stream URL is handed to the TV's
//   default media receiver, which plays it directly.
// - Safari: AirPlay through the video element's own picker.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
    WebKitPlaybackTargetAvailabilityEvent?: unknown;
  }
}

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
let sdk: Promise<boolean> | null = null;

export type CastKind = "googlecast" | "airplay" | null;

export function castKind(video: HTMLVideoElement): CastKind {
  if (window.WebKitPlaybackTargetAvailabilityEvent && "webkitShowPlaybackTargetPicker" in video) return "airplay";
  const ua = navigator.userAgent;
  if (window.chrome && !/iPhone|iPad|iPod/.test(ua) && !/Firefox/.test(ua)) return "googlecast";
  return null;
}

function loadSdk(): Promise<boolean> {
  return (sdk ??= new Promise((resolve) => {
    window.__onGCastApiAvailable = (available) => {
      if (available) {
        window.cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
      }
      resolve(available);
    };
    const script = document.createElement("script");
    script.src = SDK;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  }));
}

export interface CastMedia {
  url: string;
  title: string;
  image?: string;
  live: boolean;
}

/** Ask for a device and start playing there. Resolves to the device name, or null if the
 *  visitor cancelled or casting is not possible. `onEnd` runs when the session ends. */
export async function castTo(media: CastMedia, onEnd: () => void): Promise<string | null> {
  if (!(await loadSdk())) return null;
  const context = window.cast.framework.CastContext.getInstance();
  try {
    await context.requestSession();
  } catch {
    return null; // picker closed
  }
  const session = context.getCurrentSession();
  if (!session) return null;
  const isHls = /\.m3u8?(\?|$)/i.test(media.url) || !/\.(mp4|webm)(\?|$)/i.test(media.url);
  const info = new window.chrome.cast.media.MediaInfo(media.url, isHls ? "application/x-mpegURL" : "video/mp4");
  info.streamType = media.live ? window.chrome.cast.media.StreamType.LIVE : window.chrome.cast.media.StreamType.BUFFERED;
  info.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  info.metadata.title = media.title;
  if (media.image) info.metadata.images = [new window.chrome.cast.Image(media.image)];
  if (isHls) {
    info.hlsSegmentFormat = window.chrome.cast.media.HlsSegmentFormat.TS;
    info.hlsVideoSegmentFormat = window.chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
  }
  try {
    await session.loadMedia(new window.chrome.cast.media.LoadRequest(info));
  } catch {
    return null;
  }
  const onState = (e: any) => {
    if (e.sessionState === window.cast.framework.SessionState.SESSION_ENDED) {
      context.removeEventListener(window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, onState);
      onEnd();
    }
  };
  context.addEventListener(window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, onState);
  return session.getCastDevice()?.friendlyName ?? "TV";
}

export function stopCasting(): void {
  window.cast?.framework?.CastContext.getInstance().endCurrentSession(true);
}

export function showAirPlayPicker(video: HTMLVideoElement): void {
  (video as HTMLVideoElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker();
}
