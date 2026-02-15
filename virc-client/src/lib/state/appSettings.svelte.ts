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
}

const defaults: AppSettingsData = {
	zoom: 125,
	systemMessageDisplay: 'all',
};

function load(): AppSettingsData {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return { ...defaults, ...parsed };
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
};

/** Reset settings to defaults (for testing). */
export function resetAppSettings(): void {
	_state.zoom = defaults.zoom;
	_state.systemMessageDisplay = defaults.systemMessageDisplay;
	persist();
}
