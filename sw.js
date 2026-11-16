const CACHE = 'garagara-bingo-v1.3.8';
const ASSETS = [
  './', './index.html', './styles.css?v=1.3.8', './app.js?v=1.3.8', './src/bingo.js', './src/machine.js?v=1.3.8',
  './icon.svg', './manifest.webmanifest', './assets/garagara.glb?v=1.3.8', './assets/garagara-poster.webp?v=1.3.8',
  './vendor/three/LICENSE', './vendor/three/build/three.module.min.js', './vendor/three/build/three.core.min.js',
  './vendor/three/examples/jsm/environments/RoomEnvironment.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('garagara-bingo-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Prefer current assets online and use the cached app when the venue is offline.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  }));
});
