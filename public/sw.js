// Simple service worker to cache app shell and static assets.
// Cache version updated to force invalidation on new deployments
// Increment version number when deploying changes that require cache invalidation
const CACHE_VERSION = 'v3.1'; // Update this when deploying changes
const CACHE_NAME = 'bmsview-shell-' + CACHE_VERSION;
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/admin.html'
];

self.addEventListener('install', event => {
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache each asset individually with error handling to avoid failing the entire operation
      return Promise.all(
        ASSETS_TO_CACHE.map(url =>
          cache.add(url).catch(err => {
            console.warn(`Failed to cache ${url}:`, err);
            // Don't fail the entire cache operation for one failed asset
          })
        )
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests for same-origin
  if (event.request.method !== 'GET' || url.origin !== location.origin) {
    return;
  }

  // Serve from cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
