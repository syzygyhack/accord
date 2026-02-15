/**
 * Reactive voice state for LiveKit voice channels.
 *
 * Tracks connection status, participants, mute/deafen, and connection
 * duration. Components bind to voiceState and react to changes.
 *
 * Uses a version counter for Map reactivity (Svelte 5 $state doesn't
 * deeply track Map/Set mutations). Scalar fields use a $state object
 * for direct reactivity.
 */

export interface VoiceParticipant {
	nick: string;
	isSpeaking: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	hasVideo: boolean;
	hasScreenShare: boolean;
}

/** A video track attached to a participant for rendering in the grid. */
export interface VideoTrackInfo {
	/** Participant nick. */
	nick: string;
	/** 'camera' or 'screen'. */
	source: 'camera' | 'screen';
	/** The underlying MediaStreamTrack to attach to a <video> element. */
	track: MediaStreamTrack;
	/** LiveKit track SID for keying. */
	sid: string;
}

// --- Internal storage for Map (non-reactive) ---
const _participants = new Map<string, VoiceParticipant>();
let _mapVersion = $state(0);

function notifyMap(): void {
	_mapVersion++;
}

// --- Video tracks (non-reactive storage with version counter) ---
const _videoTracks: VideoTrackInfo[] = [];
let _videoVersion = $state(0);

function notifyVideo(): void {
	_videoVersion++;
}

// --- Scalar fields (these work fine with $state proxy) ---
interface VoiceScalars {
	isConnected: boolean;
	currentRoom: string | null;
	localMuted: boolean;
	localDeafened: boolean;
	localVideoEnabled: boolean;
	localScreenShareEnabled: boolean;
	connectDuration: number;
}

const _scalars: VoiceScalars = $state({
	isConnected: false,
	currentRoom: null,
	localMuted: false,
	localDeafened: false,
	localVideoEnabled: false,
	localScreenShareEnabled: false,
	connectDuration: 0,
});

/** Reactive voice state -- components read this directly. */
export const voiceState = {
	get isConnected() { return _scalars.isConnected; },
	set isConnected(v: boolean) { _scalars.isConnected = v; },
	get currentRoom() { return _scalars.currentRoom; },
	set currentRoom(v: string | null) { _scalars.currentRoom = v; },
	get participants() { void _mapVersion; return _participants; },
	get localMuted() { return _scalars.localMuted; },
	set localMuted(v: boolean) { _scalars.localMuted = v; },
	get localDeafened() { return _scalars.localDeafened; },
	set localDeafened(v: boolean) { _scalars.localDeafened = v; },
	get localVideoEnabled() { return _scalars.localVideoEnabled; },
	set localVideoEnabled(v: boolean) { _scalars.localVideoEnabled = v; },
	get localScreenShareEnabled() { return _scalars.localScreenShareEnabled; },
	set localScreenShareEnabled(v: boolean) { _scalars.localScreenShareEnabled = v; },
	get connectDuration() { return _scalars.connectDuration; },
	set connectDuration(v: number) { _scalars.connectDuration = v; },
	/** All active video tracks (camera + screen share) from all participants. */
	get videoTracks(): readonly VideoTrackInfo[] { void _videoVersion; return _videoTracks; },
};

/** Handle for the duration counter so we can cancel it. */
let durationTimer: ReturnType<typeof setInterval> | null = null;

/** Mark voice as connected to a room and start the duration counter. */
export function setConnected(room: string): void {
	_scalars.isConnected = true;
	_scalars.currentRoom = room;
	_scalars.connectDuration = 0;
	_scalars.localVideoEnabled = false;
	_scalars.localScreenShareEnabled = false;
	_participants.clear();
	_videoTracks.length = 0;
	notifyMap();
	notifyVideo();

	stopDurationTimer();
	durationTimer = setInterval(() => {
		_scalars.connectDuration++;
	}, 1000);
}

/** Mark voice as disconnected and clear all state. */
export function setDisconnected(): void {
	_scalars.isConnected = false;
	_scalars.currentRoom = null;
	_participants.clear();
	_videoTracks.length = 0;
	_scalars.localMuted = false;
	_scalars.localDeafened = false;
	_scalars.localVideoEnabled = false;
	_scalars.localScreenShareEnabled = false;
	_scalars.connectDuration = 0;
	notifyMap();
	notifyVideo();

	stopDurationTimer();
}

/** Toggle local microphone mute. */
export function toggleMute(): void {
	_scalars.localMuted = !_scalars.localMuted;
}

/** Whether the user was independently muted before deafening. */
let _wasMutedBeforeDeafen = false;

/** Toggle local deafen (also mutes when deafening, restores on undeafen). */
export function toggleDeafen(): void {
	_scalars.localDeafened = !_scalars.localDeafened;
	if (_scalars.localDeafened) {
		_wasMutedBeforeDeafen = _scalars.localMuted;
		_scalars.localMuted = true;
	} else {
		// Restore: only unmute if user wasn't independently muted before deafen
		_scalars.localMuted = _wasMutedBeforeDeafen;
	}
}

/** Add or update a participant in the voice channel. */
export function updateParticipant(
	nick: string,
	state: Partial<Omit<VoiceParticipant, 'nick'>>,
): void {
	const existing = _participants.get(nick);
	// Always replace the object (not mutate) so template re-renders pick up changes.
	// The Map version counter triggers re-evaluation, but Svelte's keyed {#each}
	// needs new object references to detect property changes on plain objects.
	const base: VoiceParticipant = existing ?? {
		nick,
		isSpeaking: false,
		isMuted: false,
		isDeafened: false,
		hasVideo: false,
		hasScreenShare: false,
	};
	_participants.set(nick, {
		nick,
		isSpeaking: state.isSpeaking !== undefined ? state.isSpeaking : base.isSpeaking,
		isMuted: state.isMuted !== undefined ? state.isMuted : base.isMuted,
		isDeafened: state.isDeafened !== undefined ? state.isDeafened : base.isDeafened,
		hasVideo: state.hasVideo !== undefined ? state.hasVideo : base.hasVideo,
		hasScreenShare: state.hasScreenShare !== undefined ? state.hasScreenShare : base.hasScreenShare,
	});
	notifyMap();
}

/** Remove a participant from the voice channel. */
export function removeParticipant(nick: string): void {
	_participants.delete(nick);
	notifyMap();
}

/** Add a video track to the active tracks list. */
export function addVideoTrack(info: VideoTrackInfo): void {
	// Avoid duplicates by SID
	const idx = _videoTracks.findIndex((t) => t.sid === info.sid);
	if (idx !== -1) {
		_videoTracks[idx] = info;
	} else {
		_videoTracks.push(info);
	}
	notifyVideo();
}

/** Remove a video track by SID. */
export function removeVideoTrack(sid: string): void {
	const idx = _videoTracks.findIndex((t) => t.sid === sid);
	if (idx !== -1) {
		_videoTracks.splice(idx, 1);
		notifyVideo();
	}
}

/** Stop the duration counter. */
function stopDurationTimer(): void {
	if (durationTimer !== null) {
		clearInterval(durationTimer);
		durationTimer = null;
	}
}
