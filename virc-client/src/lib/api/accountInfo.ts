/**
 * Account info fetching from virc-files /api/account-info endpoint.
 *
 * Proxies to Ergo's /v1/ns/info to retrieve account registration date.
 * Results are cached client-side to avoid duplicate requests.
 */

import { normalizeBaseUrl } from '$lib/utils/url';

export interface AccountInfo {
	accountName: string;
	registeredAt: string;
}

const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
	data: AccountInfo | null;
	expiresAt: number;
}

/** Client-side cache for account info (account name -> cache entry with TTL). */
const cache = new Map<string, CacheEntry>();

/** In-flight request deduplication: account -> pending Promise. */
const inflight = new Map<string, Promise<AccountInfo | null>>();

/** Evict expired and oldest entries when cache exceeds max size. */
function evictCache(): void {
	const now = Date.now();
	for (const [key, entry] of cache) {
		if (entry.expiresAt <= now) cache.delete(key);
	}
	if (cache.size <= CACHE_MAX_SIZE) return;
	const excess = cache.size - CACHE_MAX_SIZE;
	const keys = cache.keys();
	for (let i = 0; i < excess; i++) {
		const { value } = keys.next();
		if (value) cache.delete(value);
	}
}

/**
 * Fetch account info from virc-files.
 *
 * Returns cached result if available. Deduplicates concurrent requests.
 * Returns null on error or if the account is not found.
 */
export async function fetchAccountInfo(
	account: string,
	token: string,
	filesUrl: string,
): Promise<AccountInfo | null> {
	const cached = cache.get(account);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.data;
	}

	const pending = inflight.get(account);
	if (pending) return pending;

	const promise = _doFetch(account, token, filesUrl);
	inflight.set(account, promise);

	try {
		return await promise;
	} finally {
		inflight.delete(account);
	}
}

async function _doFetch(
	account: string,
	token: string,
	filesUrl: string,
): Promise<AccountInfo | null> {
	const baseUrl = normalizeBaseUrl(filesUrl);

	try {
		const res = await fetch(
			`${baseUrl}/api/account-info?account=${encodeURIComponent(account)}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		);

		if (!res.ok) {
			cache.set(account, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
			evictCache();
			return null;
		}

		const data = (await res.json()) as AccountInfo;
		cache.set(account, { data, expiresAt: Date.now() + CACHE_TTL_MS });
		evictCache();
		return data;
	} catch {
		cache.set(account, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
		evictCache();
		return null;
	}
}

/**
 * Check if account info is already cached.
 * Returns undefined if not cached, or the cached value (which may be null).
 */
export function getCachedAccountInfo(account: string): AccountInfo | null | undefined {
	const entry = cache.get(account);
	if (!entry) return undefined;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(account);
		return undefined;
	}
	return entry.data;
}

/** Clear the account info cache (useful for testing). */
export function clearAccountInfoCache(): void {
	cache.clear();
}

/**
 * Format an ISO date string as a human-readable date.
 * Returns "Jan 15, 2026" style string, or null if the date is invalid.
 */
export function formatRegisteredDate(isoDate: string): string | null {
	if (!isoDate) return null;
	const date = new Date(isoDate);
	if (isNaN(date.getTime())) return null;
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}
