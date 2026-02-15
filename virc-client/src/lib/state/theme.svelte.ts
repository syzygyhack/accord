/**
 * Theme state management.
 *
 * Supports 4 themes: dark, light, amoled, compact.
 * Persisted to localStorage. Respects prefers-color-scheme on first launch.
 * Server theme overrides layer CSS variable values on top of the active theme.
 */

const STORAGE_KEY = 'virc:theme';

export type Theme = 'dark' | 'light' | 'amoled' | 'compact';

const VALID_THEMES: ReadonlySet<Theme> = new Set(['dark', 'light', 'amoled', 'compact']);

/** CSS variable names that servers are allowed to override. */
const ALLOWED_OVERRIDES: ReadonlySet<string> = new Set([
	'--surface-lowest',
	'--surface-low',
	'--surface-base',
	'--surface-high',
	'--surface-highest',
	'--text-primary',
	'--text-secondary',
	'--text-muted',
	'--text-link',
	'--text-inverse',
	'--accent-primary',
	'--accent-secondary',
	'--accent-bg',
	'--danger',
	'--warning',
	'--success',
	'--info',
	'--msg-hover-bg',
	'--msg-mention-bg',
	'--msg-mention-border',
	'--status-online',
	'--status-idle',
	'--status-dnd',
	'--status-offline',
	'--interactive-normal',
	'--interactive-hover',
	'--interactive-active',
	'--interactive-muted',
]);

function detectPreferredTheme(): Theme {
	if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
		return 'light';
	}
	return 'dark';
}

function load(): Theme {
	try {
		if (typeof localStorage === 'undefined') return detectPreferredTheme();
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw && VALID_THEMES.has(raw as Theme)) {
			return raw as Theme;
		}
	} catch {
		// Storage unavailable
	}
	return detectPreferredTheme();
}

function persist(theme: Theme): void {
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Storage full or unavailable
	}
}

function applyToDOM(theme: Theme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeData {
	current: Theme;
	serverOverrides: Record<string, string>;
}

const _state: ThemeData = $state({
	current: load(),
	serverOverrides: {},
});

// Apply on init
applyToDOM(_state.current);

/** Reactive theme state — read-only from components. */
export const themeState = {
	get current(): Theme { return _state.current; },
	get serverOverrides(): Record<string, string> { return _state.serverOverrides; },
	/** True when compact/IRC-classic display mode is active. */
	get isCompact(): boolean { return _state.current === 'compact'; },
};

/** Set the active theme. Persists to localStorage and updates DOM. */
export function setTheme(theme: Theme): void {
	if (!VALID_THEMES.has(theme)) return;
	_state.current = theme;
	persist(theme);
	applyToDOM(theme);
}

/**
 * Apply server-provided theme overrides as CSS variable values.
 * Only whitelisted design tokens are applied. Non-color/unsafe values are rejected.
 */
export function applyServerTheme(overrides: Record<string, string>): void {
	if (typeof document === 'undefined') return;
	// Clear previous overrides first
	clearServerTheme();

	const applied: Record<string, string> = {};
	const root = document.documentElement;
	for (const [key, value] of Object.entries(overrides)) {
		const cssVar = key.startsWith('--') ? key : `--${key}`;
		if (!ALLOWED_OVERRIDES.has(cssVar)) continue;
		// Sanitization: reject values with url(), expression(), var(), calc(), or semicolons
		if (/url\s*\(|expression\s*\(|var\s*\(|calc\s*\(|;/i.test(value)) continue;
		root.style.setProperty(cssVar, value);
		applied[cssVar] = value;
	}
	_state.serverOverrides = applied;
}

/** Remove all server theme overrides from the DOM. */
export function clearServerTheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	for (const key of Object.keys(_state.serverOverrides)) {
		root.style.removeProperty(key);
	}
	_state.serverOverrides = {};
}

/**
 * Parse virc.json theme config into CSS variable overrides.
 * Accepts the `theme` object from virc.json:
 * { accent?: string, surfaces?: { lowest?, low?, base?, high?, highest? } }
 */
export function parseServerTheme(themeConfig: {
	accent?: string;
	surfaces?: Record<string, string>;
}): Record<string, string> {
	const overrides: Record<string, string> = {};
	if (themeConfig.accent) {
		overrides['--accent-primary'] = themeConfig.accent;
	}
	if (themeConfig.surfaces) {
		for (const [key, value] of Object.entries(themeConfig.surfaces)) {
			overrides[`--surface-${key}`] = value;
		}
	}
	return overrides;
}

/** Reset all theme state to defaults (for testing). */
export function resetTheme(): void {
	clearServerTheme();
	_state.current = 'dark';
	applyToDOM('dark');
}
