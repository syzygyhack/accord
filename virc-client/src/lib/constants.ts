/**
 * Shared constants used across the virc-client application.
 *
 * Centralizes role definitions, mode ordering, and common patterns
 * to avoid duplication across components.
 */

/** Role definition with display name and optional color. */
export interface RoleDef {
	name: string;
	color: string | null;
}

/**
 * Default role definitions matching virc-files/src/routes/config.ts.
 *
 * Used for display names and fallback colors. When virc.json is loaded,
 * server-specific overrides take precedence via serverConfig.
 */
export const DEFAULT_ROLES: Record<string, RoleDef> = {
	'~': { name: 'Owner', color: '#e0a040' },
	'&': { name: 'Admin', color: '#e05050' },
	'@': { name: 'Moderator', color: '#50a0e0' },
	'%': { name: 'Helper', color: '#50e0a0' },
	'+': { name: 'Member', color: null },
};

/** Ordered list of mode prefixes from highest to lowest privilege. */
export const MODE_ORDER = ['~', '&', '@', '%', '+'] as const;

/**
 * Regex source for matching http:// and https:// URLs in text.
 *
 * Used by linkify(), extractMediaUrls(), and extractPreviewUrl().
 * Exported as a source string because global regexes are stateful
 * (lastIndex). Consumers construct their own RegExp with `g` flag.
 *
 * @example
 * const re = new RegExp(URL_PATTERN_SOURCE, 'g');
 */
export const URL_PATTERN_SOURCE = 'https?:\\/\\/[^\\s<>"]+';

/** Create a fresh global URL-matching regex (stateful — do not share across calls). */
export function urlPattern(): RegExp {
	return new RegExp(URL_PATTERN_SOURCE, 'g');
}
