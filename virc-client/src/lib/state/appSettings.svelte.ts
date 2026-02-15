/**
 * Persistent app-wide settings store.
 *
 * Stores appearance preferences (zoom level, etc.). Persisted to
 * localStorage so settings survive app restarts.
 */

const STORAGE_KEY = 'virc:appSettings';

export type ZoomLevel = 100 | 125 | 150;

/** Controls which system messages (join/part/quit/nick/mode) are displayed. */
export type SystemMessageDisplay = 'all' | 'smart' | 'none';

interface AppSettingsData {
	zoom: ZoomLevel;
	systemMessageDisplay: SystemMessageDisplay;
	showRawIrc: boolean;
	developerMode: boolean;
}

const defaults: AppSettingsData = {
	zoom: 125,
	systemMessageDisplay: 'all',
	showRawIrc: false,
	developerMode: false,
};

const VALID_ZOOM: ReadonlySet<number> = new Set([100, 125, 150]);
const VALID_SYSTEM_DISPLAY: ReadonlySet<string> = new Set(['all', 'smart', 'none']);

function load(): AppSettingsData {
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
			};
		}
	} catch {
		// Corrupt data — reset to defaults
	}
	return { ...defaults };
}

const _state: AppSettingsData = $state(load());

function persist(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
	} catch {
		// Storage full or unavailable
	}
}

/** Reactive app settings — components read/write this directly. */
export const appSettings = {
	get zoom() { return _state.zoom; },
	set zoom(v: ZoomLevel) { _state.zoom = v; persist(); },
	get systemMessageDisplay() { return _state.systemMessageDisplay; },
	set systemMessageDisplay(v: SystemMessageDisplay) { _state.systemMessageDisplay = v; persist(); },
	get showRawIrc() { return _state.showRawIrc; },
	set showRawIrc(v: boolean) { _state.showRawIrc = v; persist(); },
	get developerMode() { return _state.developerMode; },
	set developerMode(v: boolean) { _state.developerMode = v; persist(); },
};

/** Reset settings to defaults (for testing). */
export function resetAppSettings(): void {
	_state.zoom = defaults.zoom;
	_state.systemMessageDisplay = defaults.systemMessageDisplay;
	_state.showRawIrc = defaults.showRawIrc;
	_state.developerMode = defaults.developerMode;
	persist();
}
