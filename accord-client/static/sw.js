/**
 * Service Worker for accord — caches the app shell for instant load.
 *
 * Strategy:
 *   - App shell (HTML, JS, CSS, fonts): Cache-first with background update
 *   - Static assets (images, icons): Cache-first
 *   - API calls (/api/*, /ws): Network-only (never cached)
 *   - Server config (/.well-known/): Network-first with cache fallback
 *
 * The cache version is bumped on each deploy via the build timestamp.
 */

// Cache name includes a version so old caches are purged on update.
// This is replaced at build time by the Vite plugin, or defaults to a timestamp.
const CACHE_VERSION = 'accord-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// Paths that should never be cached
const NETWORK_ONLY_PATTERNS = [
	'/api/',
	'/ws',
];

// Install: pre-cache the app shell entry point
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) => {
			// Cache the fallback HTML page (SPA entry point)
			return cache.addAll(['/']);
		}).then(() => {
			// Skip waiting so the new SW activates immediately
			return self.skipWaiting();
		})
	);
});

// Activate: clean up old caches from previous versions
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			return Promise.all(
				keys
					.filter((key) => key !== SHELL_CACHE)
					.map((key) => caches.delete(key))
			);
		}).then(() => {
			// Claim all clients so the SW handles requests immediately
			return self.clients.claim();
		})
	);
});

// Fetch: route requests based on type
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// Skip non-GET requests (POST, PUT, etc.)
	if (event.request.method !== 'GET') return;

	// Skip cross-origin requests
	if (url.origin !== self.location.origin) return;

	// Network-only for API and WebSocket paths
	if (NETWORK_ONLY_PATTERNS.some((p) => url.pathname.startsWith(p))) return;

	// Server config: network-first with cache fallback
	if (url.pathname.startsWith('/.well-known/')) {
		event.respondWith(networkFirstWithFallback(event.request));
		return;
	}

	// Immutable hashed assets (_app/immutable/): cache-first, never revalidate
	if (url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(cacheFirst(event.request));
		return;
	}

	// App shell (HTML, JS, CSS): stale-while-revalidate
	event.respondWith(staleWhileRevalidate(event.request));
});

/**
 * Cache-first: return cached response, or fetch and cache.
 * Used for immutable hashed assets that never change.
 */
async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(SHELL_CACHE);
		cache.put(request, response.clone());
	}
	return response;
}

/**
 * Stale-while-revalidate: return cached response immediately,
 * then update the cache in the background.
 * Falls back to network if no cache hit.
 */
async function staleWhileRevalidate(request) {
	const cache = await caches.open(SHELL_CACHE);
	const cached = await cache.match(request);

	// Background update (don't await)
	const fetchPromise = fetch(request).then((response) => {
		if (response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	}).catch(() => null);

	if (cached) return cached;

	// No cache hit — wait for network
	const response = await fetchPromise;
	if (response) return response;

	// Offline and no cache — return the SPA fallback
	const fallback = await cache.match('/');
	if (fallback) return fallback;

	return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

/**
 * Network-first with cache fallback.
 * Used for server config that changes infrequently.
 */
async function networkFirstWithFallback(request) {
	const cache = await caches.open(SHELL_CACHE);

	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}
