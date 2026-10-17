// Service worker for the Doubo web player (/web/ and /<lang>/web/).
// Network first, so a deploy is visible right away; the last good copy of each web player
// page and its scripts is kept so the installed app still opens without a connection.
// Streams, playlists and other origins are never cached.
const CACHE = "doubo-web-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function cacheable(url) {
  return url.origin === self.location.origin && (/^\/([a-z]{2}\/)?web\/$/.test(url.pathname) || url.pathname.startsWith("/assets/"));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !cacheable(url)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request.url.split("?")[0], copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request.url.split("?")[0])),
  );
});
