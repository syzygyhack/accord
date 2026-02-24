/**
 * Reactive store for the server's accord.json configuration.
 *
 * Populated after connecting to a server and fetching its
 * /.well-known/accord.json. Read by ServerSettings modal and
 * other components that need server metadata.
 */

import { DEFAULT_ROLES } from '$lib/constants';
import { hasLocalStorage } from '$lib/utils/storage';

const ETAG_STORAGE_KEY = 'accord:config-etag';
const CONFIG_CACHE_KEY = 'accord:config-cache';

export interface AccordConfig {
	name?: string;
	icon?: string;
	filesUrl?: string;
	description?: string;
	welcome?: {
		message?: string;
		suggested_channels?: string[];
	};
	channels?: {
		categories?: Array<{
			name: string;
			channels: string[];
			voice?: boolean;
			readonly?: boolean;
		}>;
	};
	roles?: Record<string, { name: string; color: string | null }>;
	theme?: {
		accent?: string;
		surfaces?: Record<string, string>;
	};
	emoji?: Record<string, string>;
}

interface ServerConfigStore {
	config: AccordConfig | null;
	cachedETag: string | null;
}

/** Reactive server config — components read this directly. */
export const serverConfig: ServerConfigStore = $state({
	config: null,
	cachedETag: null,
});

/** Store the fetched accord.json config. */
export function setServerConfig(config: AccordConfig): void {
	serverConfig.config = config;
}

/** Reset config (e.g. on disconnect). */
export function resetServerConfig(): void {
	serverConfig.config = null;
	serverConfig.cachedETag = null;
}

/**
 * Get cached config and ETag from localStorage.
 * Returns null if no cache exists or data is corrupted.
 */
export function getCachedConfig(): { config: AccordConfig; etag: string } | null {
	if (!hasLocalStorage()) return null;
	try {
		const etag = localStorage.getItem(ETAG_STORAGE_KEY);
		const raw = localStorage.getItem(CONFIG_CACHE_KEY);
		if (!etag || !raw) return null;
		const config = JSON.parse(raw) as AccordConfig;
		return { config, etag };
	} catch {
		return null;
	}
}

/**
 * Cache config and ETag in localStorage for conditional requests.
 */
export function setCachedConfig(config: AccordConfig, etag: string): void {
	serverConfig.cachedETag = etag;
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(ETAG_STORAGE_KEY, etag);
		localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
	} catch {
		// Storage full or unavailable — ignore
	}
}

/**
 * Validate that a color string is safe for use in CSS style attributes.
 * Prevents CSS injection from compromised server configs.
 * Allows: hex (#abc, #aabbcc), rgb/rgba, hsl/hsla, and named colors.
 */
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^;{}()]*\)|[a-zA-Z]{1,30})$/;

function isSafeColor(color: string): boolean {
	return SAFE_COLOR_RE.test(color.trim());
}

/**
 * Get the role color for a given mode prefix.
 * Uses accord.json roles if available, otherwise falls back to defaults.
 * Returns null if the mode has no configured color or color is invalid.
 */
export function getRoleColor(mode: string | null): string | null {
	if (!mode) return null;
	const roles = serverConfig.config?.roles ?? DEFAULT_ROLES;
	const color = roles[mode]?.color ?? null;
	if (color && !isSafeColor(color)) return null;
	return color;
}
