/**
 * Reactive store for the server's virc.json configuration.
 *
 * Populated after connecting to a server and fetching its
 * /.well-known/virc.json. Read by ServerSettings modal and
 * other components that need server metadata.
 */

import { DEFAULT_ROLES } from '$lib/constants';

export interface VircConfig {
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
	config: VircConfig | null;
}

/** Reactive server config — components read this directly. */
export const serverConfig: ServerConfigStore = $state({
	config: null,
});

/** Store the fetched virc.json config. */
export function setServerConfig(config: VircConfig): void {
	serverConfig.config = config;
}

/** Reset config (e.g. on disconnect). */
export function resetServerConfig(): void {
	serverConfig.config = null;
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
 * Uses virc.json roles if available, otherwise falls back to defaults.
 * Returns null if the mode has no configured color or color is invalid.
 */
export function getRoleColor(mode: string | null): string | null {
	if (!mode) return null;
	const roles = serverConfig.config?.roles ?? DEFAULT_ROLES;
	const color = roles[mode]?.color ?? null;
	if (color && !isSafeColor(color)) return null;
	return color;
}
