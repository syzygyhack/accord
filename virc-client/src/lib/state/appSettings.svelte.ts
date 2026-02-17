/**
 * Persistent app-wide settings store.
 *
 * Stores appearance preferences (zoom level, etc.). Persisted to
 * localStorage so settings survive app restarts.
 */

const STORAGE_KEY = 'accord:appSettings';

export type ZoomLevel = 100 | 125 | 150;

/** Controls which system messages (join/part/quit/nick/mode) are displayed. */
export type SystemMessageDisplay = 'all' | 'smart' | 'none';

interface AppSettingsData {
	zoom: ZoomLevel;
	systemMessageDisplay: SystemMessageDisplay;
	showRawIrc: boolean;
	developerMode: boolean;
	sidebarWidth: number;
	memberListWidth: number;
}

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 240;
export const MEMBER_MIN = 180;
export const MEMBER_MAX = 300;
export const MEMBER_DEFAULT = 240;

const defaults: AppSettingsData = {
	zoom: 125,
	systemMessageDisplay: 'smart',
	showRawIrc: false,
	developerMode: false,
	sidebarWidth: SIDEBAR_DEFAULT,
	memberListWidth: MEMBER_DEFAULT,
};

const VALID_ZOOM: ReadonlySet<number> = new Set([100, 125, 150]);
const VALID_SYSTEM_DISPLAY: ReadonlySet<string> = new Set(['all', 'smart', 'none']);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

function load(): AppSettingsData {
	if (typeof localStorage === 'undefined') return { ...defaults };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				zoom: VALID_ZOOM.has(parsed.zoom) ? parsed.zoom : defaults.zoom,
				systemMessageDisplay: VALID_SYSTEM_DISPLAY.has(parsed.systemMessageDisplay)
					? parsed.systemMessageDisplay
					: defaults.systemMessageDisplay,
				showRawIrc: typeof parsed.showRawIrc === 'boolean' ? parsed.showRawIrc : defaults.showRawIrc,
				developerMode: typeof parsed.developerMode === 'boolean' ? parsed.developerMode : defaults.developerMode,
				sidebarWidth: clampNumber(parsed.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT),
				memberListWidth: clampNumber(parsed.memberListWidth, MEMBER_MIN, MEMBER_MAX, MEMBER_DEFAULT),
			};
		}
	} catch {
		// Corrupt data — reset to defaults
	}
	return { ...defaults };
}

const _state: AppSettingsData = $state(load());

function persist(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
	} catch {
		// Storage full or unavailable
	}
}

/** Reactive app settings — components read/write this directly. */
export const appSettings = {
	get zoom() { return _state.zoom; },
	set zoom(v: ZoomLevel) { if (!VALID_ZOOM.has(v)) return; _state.zoom = v; persist(); },
	get systemMessageDisplay() { return _state.systemMessageDisplay; },
	set systemMessageDisplay(v: SystemMessageDisplay) { _state.systemMessageDisplay = v; persist(); },
	get showRawIrc() { return _state.showRawIrc; },
	set showRawIrc(v: boolean) { _state.showRawIrc = v; persist(); },
	get developerMode() { return _state.developerMode; },
	set developerMode(v: boolean) { _state.developerMode = v; persist(); },
	get sidebarWidth() { return _state.sidebarWidth; },
	set sidebarWidth(v: number) { _state.sidebarWidth = clampNumber(v, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT); persist(); },
	get memberListWidth() { return _state.memberListWidth; },
	set memberListWidth(v: number) { _state.memberListWidth = clampNumber(v, MEMBER_MIN, MEMBER_MAX, MEMBER_DEFAULT); persist(); },
};

/** Reset settings to defaults (for testing). */
export function resetAppSettings(): void {
	_state.zoom = defaults.zoom;
	_state.systemMessageDisplay = defaults.systemMessageDisplay;
	_state.showRawIrc = defaults.showRawIrc;
	_state.developerMode = defaults.developerMode;
	_state.sidebarWidth = defaults.sidebarWidth;
	_state.memberListWidth = defaults.memberListWidth;
	persist();
}
