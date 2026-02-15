import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	voiceState,
	setConnected,
	setDisconnected,
	toggleMute,
	toggleDeafen,
	updateParticipant,
	removeParticipant,
	addVideoTrack,
	removeVideoTrack,
} from './voice.svelte';

describe('voiceState', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Reset to clean state before each test.
		setDisconnected();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts disconnected with empty state', () => {
		expect(voiceState.isConnected).toBe(false);
		expect(voiceState.currentRoom).toBeNull();
		expect(voiceState.participants.size).toBe(0);
		expect(voiceState.localMuted).toBe(false);
		expect(voiceState.localDeafened).toBe(false);
		expect(voiceState.localVideoEnabled).toBe(false);
		expect(voiceState.localScreenShareEnabled).toBe(false);
		expect(voiceState.connectDuration).toBe(0);
		expect(voiceState.videoTracks.length).toBe(0);
	});

	it('setConnected() marks as connected and starts duration counter', () => {
		setConnected('#voice');

		expect(voiceState.isConnected).toBe(true);
		expect(voiceState.currentRoom).toBe('#voice');
		expect(voiceState.connectDuration).toBe(0);

		// Advance 3 seconds and check duration.
		vi.advanceTimersByTime(3000);
		expect(voiceState.connectDuration).toBe(3);
	});

	it('setDisconnected() resets all state and stops duration counter', () => {
		setConnected('#voice');
		updateParticipant('alice', { isSpeaking: true });
		voiceState.localMuted = true;

		vi.advanceTimersByTime(2000);
		expect(voiceState.connectDuration).toBe(2);

		setDisconnected();

		expect(voiceState.isConnected).toBe(false);
		expect(voiceState.currentRoom).toBeNull();
		expect(voiceState.participants.size).toBe(0);
		expect(voiceState.localMuted).toBe(false);
		expect(voiceState.localDeafened).toBe(false);
		expect(voiceState.connectDuration).toBe(0);

		// Duration counter should be stopped.
		vi.advanceTimersByTime(5000);
		expect(voiceState.connectDuration).toBe(0);
	});

	it('setConnected() clears existing participants', () => {
		setConnected('#voice-1');
		updateParticipant('alice', {});

		setConnected('#voice-2');
		expect(voiceState.participants.size).toBe(0);
		expect(voiceState.currentRoom).toBe('#voice-2');
	});

	it('toggleMute() toggles local mute state', () => {
		expect(voiceState.localMuted).toBe(false);

		toggleMute();
		expect(voiceState.localMuted).toBe(true);

		toggleMute();
		expect(voiceState.localMuted).toBe(false);
	});

	it('toggleDeafen() deafens and also mutes', () => {
		expect(voiceState.localDeafened).toBe(false);
		expect(voiceState.localMuted).toBe(false);

		toggleDeafen();
		expect(voiceState.localDeafened).toBe(true);
		expect(voiceState.localMuted).toBe(true);
	});

	it('toggleDeafen() un-deafens and restores mute to pre-deafen state', () => {
		toggleDeafen(); // deafen + mute (was not muted before)
		expect(voiceState.localDeafened).toBe(true);
		expect(voiceState.localMuted).toBe(true);

		toggleDeafen(); // un-deafen — restores localMuted to false
		expect(voiceState.localDeafened).toBe(false);
		expect(voiceState.localMuted).toBe(false);
	});

	it('toggleDeafen() un-deafens and keeps mute if was muted before', () => {
		toggleMute(); // independently mute
		expect(voiceState.localMuted).toBe(true);

		toggleDeafen(); // deafen (was already muted)
		expect(voiceState.localDeafened).toBe(true);
		expect(voiceState.localMuted).toBe(true);

		toggleDeafen(); // un-deafen — restores localMuted to true (was muted before)
		expect(voiceState.localDeafened).toBe(false);
		expect(voiceState.localMuted).toBe(true);
	});

	it('updateParticipant() adds a new participant with defaults', () => {
		updateParticipant('alice', {});

		const p = voiceState.participants.get('alice');
		expect(p).toBeDefined();
		expect(p!.nick).toBe('alice');
		expect(p!.isSpeaking).toBe(false);
		expect(p!.isMuted).toBe(false);
		expect(p!.isDeafened).toBe(false);
		expect(p!.hasVideo).toBe(false);
		expect(p!.hasScreenShare).toBe(false);
	});

	it('updateParticipant() adds a new participant with specified state', () => {
		updateParticipant('bob', { isSpeaking: true, isMuted: true });

		const p = voiceState.participants.get('bob');
		expect(p).toBeDefined();
		expect(p!.isSpeaking).toBe(true);
		expect(p!.isMuted).toBe(true);
		expect(p!.isDeafened).toBe(false);
	});

	it('updateParticipant() updates an existing participant partially', () => {
		updateParticipant('alice', { isSpeaking: false, isMuted: false });
		updateParticipant('alice', { isSpeaking: true });

		const p = voiceState.participants.get('alice');
		expect(p!.isSpeaking).toBe(true);
		expect(p!.isMuted).toBe(false); // unchanged
	});

	it('removeParticipant() removes a participant', () => {
		updateParticipant('alice', {});
		updateParticipant('bob', {});
		expect(voiceState.participants.size).toBe(2);

		removeParticipant('alice');
		expect(voiceState.participants.size).toBe(1);
		expect(voiceState.participants.has('alice')).toBe(false);
		expect(voiceState.participants.has('bob')).toBe(true);
	});

	it('removeParticipant() is a no-op for unknown nick', () => {
		updateParticipant('alice', {});
		removeParticipant('unknown');
		expect(voiceState.participants.size).toBe(1);
	});

	it('updateParticipant() tracks video and screen share flags', () => {
		updateParticipant('alice', { hasVideo: true });
		const p = voiceState.participants.get('alice');
		expect(p!.hasVideo).toBe(true);
		expect(p!.hasScreenShare).toBe(false);

		updateParticipant('alice', { hasScreenShare: true });
		const p2 = voiceState.participants.get('alice');
		expect(p2!.hasVideo).toBe(true);
		expect(p2!.hasScreenShare).toBe(true);
	});

	it('addVideoTrack() adds a track and removeVideoTrack() removes it', () => {
		const fakeTrack = {} as MediaStreamTrack;
		addVideoTrack({ nick: 'alice', source: 'camera', track: fakeTrack, sid: 'track-1' });
		expect(voiceState.videoTracks.length).toBe(1);
		expect(voiceState.videoTracks[0].nick).toBe('alice');
		expect(voiceState.videoTracks[0].source).toBe('camera');

		removeVideoTrack('track-1');
		expect(voiceState.videoTracks.length).toBe(0);
	});

	it('addVideoTrack() deduplicates by SID', () => {
		const fakeTrack = {} as MediaStreamTrack;
		addVideoTrack({ nick: 'alice', source: 'camera', track: fakeTrack, sid: 'track-1' });
		addVideoTrack({ nick: 'alice', source: 'camera', track: fakeTrack, sid: 'track-1' });
		expect(voiceState.videoTracks.length).toBe(1);
	});

	it('setConnected() clears video tracks', () => {
		const fakeTrack = {} as MediaStreamTrack;
		addVideoTrack({ nick: 'alice', source: 'screen', track: fakeTrack, sid: 'track-1' });
		expect(voiceState.videoTracks.length).toBe(1);

		setConnected('#voice');
		expect(voiceState.videoTracks.length).toBe(0);
	});

	it('setDisconnected() clears video state', () => {
		setConnected('#voice');
		voiceState.localVideoEnabled = true;
		voiceState.localScreenShareEnabled = true;
		const fakeTrack = {} as MediaStreamTrack;
		addVideoTrack({ nick: 'alice', source: 'camera', track: fakeTrack, sid: 'track-1' });

		setDisconnected();
		expect(voiceState.localVideoEnabled).toBe(false);
		expect(voiceState.localScreenShareEnabled).toBe(false);
		expect(voiceState.videoTracks.length).toBe(0);
	});
});
