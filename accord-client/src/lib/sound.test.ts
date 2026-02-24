import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playNotificationSound, closeAudioContext, _setAudioContextForTesting } from './sound';
import { appSettings, resetAppSettings } from '$lib/state/appSettings.svelte';

function createStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() { return store.size; },
		key: (_index: number) => null,
	} as Storage;
}

/** Minimal mock AudioContext that records calls. */
function createMockAudioContext() {
	const oscillators: { type: string; start: any; stop: any; connect: any; frequency: any }[] = [];
	const gainNodes: { gain: any; connect: any }[] = [];

	const mockCtx = {
		state: 'running' as AudioContextState,
		currentTime: 0,
		destination: {},
		resume: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		createOscillator: vi.fn(() => {
			const osc = {
				type: 'sine',
				frequency: {
					setValueAtTime: vi.fn(),
				},
				connect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
			};
			oscillators.push(osc);
			return osc;
		}),
		createGain: vi.fn(() => {
			const node = {
				gain: {
					setValueAtTime: vi.fn(),
					linearRampToValueAtTime: vi.fn(),
				},
				connect: vi.fn(),
			};
			gainNodes.push(node);
			return node;
		}),
		_oscillators: oscillators,
		_gainNodes: gainNodes,
	};

	return mockCtx as unknown as AudioContext & {
		_oscillators: typeof oscillators;
		_gainNodes: typeof gainNodes;
	};
}

describe('sound', () => {
	let mockCtx: ReturnType<typeof createMockAudioContext>;

	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		resetAppSettings();
		mockCtx = createMockAudioContext();
		_setAudioContextForTesting(mockCtx as unknown as AudioContext);
	});

	afterEach(() => {
		_setAudioContextForTesting(null);
		vi.unstubAllGlobals();
	});

	it('plays a mention sound with two tones', () => {
		playNotificationSound('mention');
		expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
		expect(mockCtx.createGain).toHaveBeenCalledTimes(2);
	});

	it('plays a dm sound with two tones', () => {
		playNotificationSound('dm');
		expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
	});

	it('plays a message sound with one tone', () => {
		playNotificationSound('message');
		expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
	});

	it('does nothing when sounds are disabled', () => {
		appSettings.notificationSoundsEnabled = false;
		playNotificationSound('mention');
		expect(mockCtx.createOscillator).not.toHaveBeenCalled();
	});

	it('does nothing when volume is 0', () => {
		appSettings.notificationVolume = 0;
		playNotificationSound('mention');
		expect(mockCtx.createOscillator).not.toHaveBeenCalled();
	});

	it('connects oscillator to gain node and gain to destination', () => {
		playNotificationSound('message');
		const osc = mockCtx._oscillators[0];
		const gain = mockCtx._gainNodes[0];
		expect(osc.connect).toHaveBeenCalledWith(gain);
		expect(gain.connect).toHaveBeenCalledWith(mockCtx.destination);
	});

	it('starts and stops the oscillator', () => {
		playNotificationSound('message');
		const osc = mockCtx._oscillators[0];
		expect(osc.start).toHaveBeenCalled();
		expect(osc.stop).toHaveBeenCalled();
	});

	it('sets the frequency based on tone preset', () => {
		playNotificationSound('message');
		const osc = mockCtx._oscillators[0];
		// message preset frequency is 440
		expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(440, expect.any(Number));
	});

	it('uses sine wave type for oscillator', () => {
		playNotificationSound('mention');
		const osc = mockCtx._oscillators[0];
		expect(osc.type).toBe('sine');
	});

	it('applies gain envelope (attack and release)', () => {
		playNotificationSound('message');
		const gain = mockCtx._gainNodes[0];
		// Should have: setValueAtTime(0), linearRamp (attack), setValueAtTime (sustain), linearRamp (release)
		expect(gain.gain.setValueAtTime).toHaveBeenCalledTimes(2);
		expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
	});

	it('scales gain by volume setting', () => {
		appSettings.notificationVolume = 100;
		playNotificationSound('message');
		const gain = mockCtx._gainNodes[0];
		// At volume 100, gain should be 1.0 * 0.3 = 0.3
		expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, expect.any(Number));
	});

	it('scales gain with lower volume', () => {
		appSettings.notificationVolume = 50;
		playNotificationSound('message');
		const gain = mockCtx._gainNodes[0];
		// At volume 50, gain should be 0.5 * 0.3 = 0.15
		expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.15, expect.any(Number));
	});

	it('resumes suspended audio context', () => {
		(mockCtx as any).state = 'suspended';
		playNotificationSound('message');
		expect(mockCtx.resume).toHaveBeenCalled();
	});

	it('does not resume running audio context', () => {
		playNotificationSound('message');
		expect(mockCtx.resume).not.toHaveBeenCalled();
	});

	it('mention plays tones at 880 and 1100 Hz', () => {
		playNotificationSound('mention');
		expect(mockCtx._oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number));
		expect(mockCtx._oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(1100, expect.any(Number));
	});
});
