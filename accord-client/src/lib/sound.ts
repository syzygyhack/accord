/**
 * Notification sound playback using Web Audio API.
 *
 * Generates simple synthesized tones for different notification types.
 * No audio files needed — tones are created programmatically.
 * Respects the notificationSoundsEnabled and notificationVolume settings.
 */

import { appSettings } from '$lib/state/appSettings.svelte';

export type NotificationSoundType = 'mention' | 'message' | 'dm';

/** Frequency/duration presets for each notification type. */
const TONE_PRESETS: Record<NotificationSoundType, { frequencies: number[]; duration: number }> = {
	mention: { frequencies: [880, 1100], duration: 0.12 },
	dm: { frequencies: [660, 880], duration: 0.15 },
	message: { frequencies: [440], duration: 0.1 },
};

let _audioContext: AudioContext | null = null;

/** Get or create a shared AudioContext (lazy-initialized). Returns null if Web Audio API unavailable. */
function getAudioContext(): AudioContext | null {
	// If a test context was injected, use it directly
	if (_audioContext && _audioContext.state !== 'closed') return _audioContext;
	if (typeof AudioContext === 'undefined') return null;
	_audioContext = new AudioContext();
	return _audioContext;
}

/**
 * Play a notification sound of the given type.
 *
 * Respects `appSettings.notificationSoundsEnabled` and `appSettings.notificationVolume`.
 * Does nothing if sounds are disabled or volume is 0.
 */
export function playNotificationSound(type: NotificationSoundType): void {
	if (!appSettings.notificationSoundsEnabled) return;
	if (appSettings.notificationVolume <= 0) return;

	const preset = TONE_PRESETS[type];
	if (!preset) return;

	const ctx = getAudioContext();
	if (!ctx) return;

	// Resume if suspended (browsers require user gesture to start AudioContext)
	if (ctx.state === 'suspended') {
		ctx.resume();
	}

	const volume = appSettings.notificationVolume / 100;
	const now = ctx.currentTime;

	for (let i = 0; i < preset.frequencies.length; i++) {
		const freq = preset.frequencies[i];
		const startTime = now + i * preset.duration;

		const oscillator = ctx.createOscillator();
		const gainNode = ctx.createGain();

		oscillator.type = 'sine';
		oscillator.frequency.setValueAtTime(freq, startTime);

		// Envelope: quick attack, sustain, quick release
		gainNode.gain.setValueAtTime(0, startTime);
		gainNode.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01);
		gainNode.gain.setValueAtTime(volume * 0.3, startTime + preset.duration - 0.02);
		gainNode.gain.linearRampToValueAtTime(0, startTime + preset.duration);

		oscillator.connect(gainNode);
		gainNode.connect(ctx.destination);

		oscillator.start(startTime);
		oscillator.stop(startTime + preset.duration);
	}
}

/** Close the shared AudioContext (for cleanup/testing). */
export function closeAudioContext(): void {
	if (_audioContext) {
		_audioContext.close();
		_audioContext = null;
	}
}

/**
 * Replace the internal AudioContext (for testing).
 * Pass null to reset to default behavior.
 */
export function _setAudioContextForTesting(ctx: AudioContext | null): void {
	_audioContext = ctx;
}
