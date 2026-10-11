// Service worker: que el emulador cargue sin red y sin trabajo extra.
//
//  - Archivos de EmulatorJS (CDN, versión fija): CACHÉ PRIMERO. Si ya están guardados se
//    responden al instante, sin volver a pedirlos a la red ni reescribirlos.
//  - Tu propia web (index.html, manifest...): se responde desde la caché y se actualiza en
//    segundo plano; los cambios que subas se ven a la segunda carga.
//  - Todo lo demás (tu Worker de ROMs, etc.) pasa sin tocar.
//
// Para forzar que todos los teléfonos descarguen todo de nuevo, sube el número de CACHE.
const CACHE = "emu-v3";
const CDN = "cdn.emulatorjs.org";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheFirst(e) {
  const url = e.request.url;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url, { ignoreVary: true });
  if (hit) return hit;                       // sin red, sin reescribir

  let res;
  try {
    // Con CORS la respuesta es normal (no "opaca") y se puede guardar. Los <script> y
    // <link> del CDN llegan sin CORS y de otro modo nunca se guardarían.
    res = await fetch(url, { mode: "cors", credentials: "omit" });
  } catch (err) {
    return fetch(e.request);                 // el servidor no admite CORS: se sirve sin guardar
  }
  if (res.status === 200) e.waitUntil(cache.put(url, res.clone()).catch(() => {}));
  return res;
}

function staleWhileRevalidate(e) {
  const req = e.request;
  const update = caches.open(CACHE).then(async (cache) => {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  e.waitUntil(update.catch(() => {}));       // sin red: no es un error
  return caches.open(CACHE).then(async (cache) =>
    (await cache.match(req, { ignoreSearch: true })) || update
  );
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname === CDN) e.respondWith(cacheFirst(e));
  else if (url.origin === self.location.origin) e.respondWith(staleWhileRevalidate(e));
});