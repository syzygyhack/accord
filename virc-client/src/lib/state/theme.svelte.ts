/**
 * Theme state management.
 *
 * Supports 4 themes: dark, light, amoled, compact.
 * Persisted to localStorage. Respects prefers-color-scheme on first launch.
 * Server theme overrides layer CSS variable values on top of the active theme.
 *
 * Users can disable server themes globally or per-server.
 * Contrast ratio checking warns when server themes produce unreadable text.
 */

const STORAGE_KEY = 'accord:theme';
const SERVER_THEME_PREFS_KEY = 'accord:serverThemePrefs';

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

/** Persisted user preferences for server theme overrides. */
interface ServerThemePrefs {
	/** When true, all server themes are ignored. */
	disableAll: boolean;
	/** Set of server IDs whose themes are individually disabled. */
	disabledServers: string[];
}

function loadServerThemePrefs(): ServerThemePrefs {
	try {
		if (typeof localStorage === 'undefined') return { disableAll: false, disabledServers: [] };
		const raw = localStorage.getItem(SERVER_THEME_PREFS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				disableAll: typeof parsed.disableAll === 'boolean' ? parsed.disableAll : false,
				disabledServers: Array.isArray(parsed.disabledServers) ? parsed.disabledServers : [],
			};
		}
	} catch {
		// Corrupt data
	}
	return { disableAll: false, disabledServers: [] };
}

function persistServerThemePrefs(prefs: ServerThemePrefs): void {
	try {
		localStorage.setItem(SERVER_THEME_PREFS_KEY, JSON.stringify(prefs));
	} catch {
		// Storage full or unavailable
	}
}

/** Result of applying a server theme with contrast checking. */
export interface ServerThemeResult {
	applied: boolean;
	contrastWarning: string | null;
}

/**
 * Parse a CSS color string to RGB components.
 * Supports hex (#rgb, #rrggbb, #rrggbbaa) and rgb()/rgba() notation.
 */
export function parseColor(color: string): { r: number; g: number; b: number } | null {
	const trimmed = color.trim();

	// Hex: #rgb, #rrggbb, #rrggbbaa
	const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
	if (hexMatch) {
		const hex = hexMatch[1];
		if (hex.length === 3) {
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length >= 6) {
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
			};
		}
	}

	// rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		return {
			r: parseInt(rgbMatch[1], 10),
			g: parseInt(rgbMatch[2], 10),
			b: parseInt(rgbMatch[3], 10),
		};
	}

	return null;
}

/**
 * Compute relative luminance per WCAG 2.1.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(r: number, g: number, b: number): number {
	const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
		c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
	);
	return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Compute contrast ratio between two colors per WCAG 2.1.
 * Returns a value >= 1. A ratio < 3:1 indicates poor readability.
 */
export function contrastRatio(
	fg: { r: number; g: number; b: number },
	bg: { r: number; g: number; b: number },
): number {
	const l1 = relativeLuminance(fg.r, fg.g, fg.b);
	const l2 = relativeLuminance(bg.r, bg.g, bg.b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum contrast ratio for readable text (WCAG AA large text). */
const MIN_CONTRAST_RATIO = 3;

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
	serverThemePrefs: ServerThemePrefs;
	contrastWarning: string | null;
}

const _state: ThemeData = $state({
	current: load(),
	serverOverrides: {},
	serverThemePrefs: loadServerThemePrefs(),
	contrastWarning: null,
});

// Apply on init
applyToDOM(_state.current);

/** Reactive theme state — read-only from components. */
export const themeState = {
	get current(): Theme { return _state.current; },
	get serverOverrides(): Record<string, string> { return _state.serverOverrides; },
	/** True when compact/IRC-classic display mode is active. */
	get isCompact(): boolean { return _state.current === 'compact'; },
	/** True when all server themes are globally disabled. */
	get serverThemesDisabled(): boolean { return _state.serverThemePrefs.disableAll; },
	/** Set of server IDs with individually disabled themes. */
	get disabledServerIds(): string[] { return _state.serverThemePrefs.disabledServers; },
	/** Non-null when the last applied server theme has poor contrast. */
	get contrastWarning(): string | null { return _state.contrastWarning; },
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
 *
 * If a serverId is provided, checks whether server themes are globally disabled
 * or the specific server is disabled. Returns a result indicating whether the
 * theme was applied and whether a contrast warning was generated.
 */
export function applyServerTheme(overrides: Record<string, string>, serverId?: string): ServerThemeResult {
	if (typeof document === 'undefined') return { applied: false, contrastWarning: null };

	// Check if server themes are disabled
	if (_state.serverThemePrefs.disableAll) {
		clearServerTheme();
		return { applied: false, contrastWarning: null };
	}
	if (serverId && _state.serverThemePrefs.disabledServers.includes(serverId)) {
		clearServerTheme();
		return { applied: false, contrastWarning: null };
	}

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

	// Check contrast between text and background colors
	const warning = checkThemeContrast(applied);
	_state.contrastWarning = warning;

	return { applied: Object.keys(applied).length > 0, contrastWarning: warning };
}

/**
 * Check contrast ratio between text and background in the applied overrides.
 * Returns a warning message if any text/background pair has contrast < 3:1, else null.
 */
export function checkThemeContrast(overrides: Record<string, string>): string | null {
	const textVars = ['--text-primary', '--text-secondary', '--text-muted'];
	const bgVars = ['--surface-base', '--surface-lowest', '--surface-low'];

	// Collect colors from overrides (or skip if not overridden)
	const textColors: { name: string; color: { r: number; g: number; b: number } }[] = [];
	const bgColors: { name: string; color: { r: number; g: number; b: number } }[] = [];

	for (const v of textVars) {
		if (overrides[v]) {
			const parsed = parseColor(overrides[v]);
			if (parsed) textColors.push({ name: v, color: parsed });
		}
	}
	for (const v of bgVars) {
		if (overrides[v]) {
			const parsed = parseColor(overrides[v]);
			if (parsed) bgColors.push({ name: v, color: parsed });
		}
	}

	// Need at least one of each to check
	if (textColors.length === 0 || bgColors.length === 0) return null;

	for (const text of textColors) {
		for (const bg of bgColors) {
			const ratio = contrastRatio(text.color, bg.color);
			if (ratio < MIN_CONTRAST_RATIO) {
				return `Server theme may be hard to read: ${text.name} on ${bg.name} has contrast ratio ${ratio.toFixed(1)}:1 (minimum 3:1)`;
			}
		}
	}

	return null;
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

/** Toggle the global "disable all server themes" preference. */
export function setServerThemesDisabled(disabled: boolean): void {
	_state.serverThemePrefs.disableAll = disabled;
	persistServerThemePrefs(_state.serverThemePrefs);
	if (disabled) {
		clearServerTheme();
		_state.contrastWarning = null;
	}
}

/** Toggle server theme for a specific server ID. */
export function setServerThemeDisabled(serverId: string, disabled: boolean): void {
	const set = new Set(_state.serverThemePrefs.disabledServers);
	if (disabled) {
		set.add(serverId);
	} else {
		set.delete(serverId);
	}
	_state.serverThemePrefs.disabledServers = [...set];
	persistServerThemePrefs(_state.serverThemePrefs);
	if (disabled) {
		clearServerTheme();
		_state.contrastWarning = null;
	}
}

/** Check if a specific server's theme is disabled (individually, not global). */
export function isServerThemeDisabled(serverId: string): boolean {
	return _state.serverThemePrefs.disabledServers.includes(serverId);
}

/** Dismiss the current contrast warning without disabling the theme. */
export function dismissContrastWarning(): void {
	_state.contrastWarning = null;
}

/** Reset all theme state to defaults (for testing). */
export function resetTheme(): void {
	clearServerTheme();
	_state.current = 'dark';
	_state.serverThemePrefs = { disableAll: false, disabledServers: [] };
	_state.contrastWarning = null;
	applyToDOM('dark');
}
