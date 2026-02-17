/**
 * Persistent audio settings store.
 *
 * Stores input/output device selection, volume levels, and push-to-talk
 * configuration. Persisted to localStorage so settings survive app restarts.
 */

const STORAGE_KEY = 'accord:audioSettings';

export type VideoQuality = '360' | '720' | '1080' | '1440';
const VALID_QUALITIES: readonly string[] = ['360', '720', '1080', '1440'];

interface AudioSettingsData {
	inputDeviceId: string;
	outputDeviceId: string;
	videoDeviceId: string;
	videoQuality: VideoQuality;
	outputVolume: number;
	pushToTalk: boolean;
	pttKey: string;
	noiseSuppression: boolean;
}

const defaults: AudioSettingsData = {
	inputDeviceId: 'default',
	outputDeviceId: 'default',
	videoDeviceId: 'default',
	videoQuality: '720',
	outputVolume: 100,
	pushToTalk: false,
	pttKey: 'Space',
	noiseSuppression: true,
};

function load(): AudioSettingsData {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			const merged = { ...defaults, ...parsed };
			// Validate videoQuality against allowed values.
			if (!VALID_QUALITIES.includes(merged.videoQuality)) {
				merged.videoQuality = defaults.videoQuality;
			}
			return merged;
		}
	} catch {
		// Corrupt data — reset to defaults
	}
	return { ...defaults };
}

const _state: AudioSettingsData = $state(load());

function persist(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
	} catch {
		// Storage full or unavailable
	}
}

/** Reactive audio settings — components read/write this directly. */
export const audioSettings = {
	get inputDeviceId() { return _state.inputDeviceId; },
	set inputDeviceId(v: string) { _state.inputDeviceId = v; persist(); },

	get outputDeviceId() { return _state.outputDeviceId; },
	set outputDeviceId(v: string) { _state.outputDeviceId = v; persist(); },

	get videoDeviceId() { return _state.videoDeviceId; },
	set videoDeviceId(v: string) { _state.videoDeviceId = v; persist(); },

	get videoQuality() { return _state.videoQuality; },
	set videoQuality(v: VideoQuality) { _state.videoQuality = v; persist(); },

	get outputVolume() { return _state.outputVolume; },
	set outputVolume(v: number) { _state.outputVolume = v; persist(); },

	get pushToTalk() { return _state.pushToTalk; },
	set pushToTalk(v: boolean) { _state.pushToTalk = v; persist(); },

	get pttKey() { return _state.pttKey; },
	set pttKey(v: string) { _state.pttKey = v; persist(); },

	get noiseSuppression() { return _state.noiseSuppression; },
	set noiseSuppression(v: boolean) { _state.noiseSuppression = v; persist(); },
};
