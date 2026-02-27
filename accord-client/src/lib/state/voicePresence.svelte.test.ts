import { describe, it, expect, beforeEach } from 'vitest';
import {
	voicePresence,
	setVoicePresence,
	resetVoicePresence,
} from './voicePresence.svelte';

describe('voicePresence', () => {
	beforeEach(() => {
		resetVoicePresence();
	});

	it('starts empty', () => {
		expect(voicePresence.get('#voice-lobby')).toEqual([]);
		expect(voicePresence.rooms.size).toBe(0);
	});

	it('setVoicePresence() populates rooms', () => {
		setVoicePresence({
			'#voice-lobby': ['alice', 'bob'],
			'#gaming': ['charlie'],
		});

		expect(voicePresence.get('#voice-lobby')).toEqual(['alice', 'bob']);
		expect(voicePresence.get('#gaming')).toEqual(['charlie']);
		expect(voicePresence.rooms.size).toBe(2);
	});

	it('setVoicePresence() replaces previous data', () => {
		setVoicePresence({ '#voice-lobby': ['alice'] });
		setVoicePresence({ '#gaming': ['bob'] });

		expect(voicePresence.get('#voice-lobby')).toEqual([]);
		expect(voicePresence.get('#gaming')).toEqual(['bob']);
		expect(voicePresence.rooms.size).toBe(1);
	});

	it('resetVoicePresence() clears all data', () => {
		setVoicePresence({ '#voice-lobby': ['alice', 'bob'] });
		resetVoicePresence();

		expect(voicePresence.get('#voice-lobby')).toEqual([]);
		expect(voicePresence.rooms.size).toBe(0);
	});

	it('get() returns empty array for unknown channel', () => {
		setVoicePresence({ '#voice-lobby': ['alice'] });
		expect(voicePresence.get('#nonexistent')).toEqual([]);
	});
});
