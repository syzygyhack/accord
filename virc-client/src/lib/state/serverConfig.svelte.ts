/**
 * Reactive store for the server's virc.json configuration.
 *
 * Populated after connecting to a server and fetching its
 * /.well-known/virc.json. Read by ServerSettings modal and
 * other components that need server metadata.
 */

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

/** Default role definitions matching virc-files/src/routes/config.ts. */
const DEFAULT_ROLES: Record<string, { name: string; color: string | null }> = {
	'~': { name: 'Owner', color: '#e0a040' },
	'&': { name: 'Admin', color: '#e05050' },
	'@': { name: 'Moderator', color: '#50a0e0' },
	'%': { name: 'Helper', color: '#50e0a0' },
	'+': { name: 'Member', color: null },
};

/**
 * Get the role color for a given mode prefix.
 * Uses virc.json roles if available, otherwise falls back to defaults.
 * Returns null if the mode has no configured color.
 */
export function getRoleColor(mode: string | null): string | null {
	if (!mode) return null;
	const roles = serverConfig.config?.roles ?? DEFAULT_ROLES;
	return roles[mode]?.color ?? null;
}
