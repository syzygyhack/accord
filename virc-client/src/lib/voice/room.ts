/**
 * LiveKit room management for voice channels.
 *
 * Wraps livekit-client to provide connect/disconnect/mute/deafen
 * and keeps the reactive voiceState in sync via event listeners.
 */

import {
	Room,
	RoomEvent,
	Track,
	VideoPresets,
	type RemoteParticipant,
	type RemoteTrackPublication,
	type Participant,
	type TrackPublication,
	type AudioCaptureOptions,
	type VideoCaptureOptions,
	type LocalTrackPublication,
} from 'livekit-client';

import {
	setConnected,
	setDisconnected,
	toggleMute as toggleMuteState,
	toggleDeafen as toggleDeafenState,
	updateParticipant,
	removeParticipant,
	addVideoTrack,
	removeVideoTrack,
	voiceState,
} from '$lib/state/voice.svelte';
import { audioSettings, type VideoQuality } from '$lib/state/audioSettings.svelte';

/** Map user-facing quality label to LiveKit VideoPreset. */
const qualityPresets: Record<VideoQuality, (typeof VideoPresets)[keyof typeof VideoPresets]> = {
	'360': VideoPresets.h360,
	'720': VideoPresets.h720,
	'1080': VideoPresets.h1080,
	'1440': VideoPresets.h1440,
};

/**
 * Get the display identity for a participant.
 * Falls back to the participant's identity string.
 */
function participantNick(p: Participant): string {
	return p.identity;
}

/**
 * Connect to a LiveKit room for a voice channel.
 *
 * Creates a Room, connects with the provided token, enables the local
 * microphone, and wires up event listeners to keep voiceState current.
 */
export async function connectToVoice(
	channel: string,
	livekitUrl: string,
	token: string,
): Promise<Room> {
	// Configure room with selected audio devices and processing.
	const audioCaptureOpts: AudioCaptureOptions = {
		noiseSuppression: audioSettings.noiseSuppression,
		// Keep echo cancellation and auto gain — they help in voice chat.
		echoCancellation: true,
		autoGainControl: true,
	};
	if (audioSettings.inputDeviceId !== 'default') {
		audioCaptureOpts.deviceId = { exact: audioSettings.inputDeviceId };
	}

	const videoCaptureOpts: VideoCaptureOptions = {
		resolution: qualityPresets[audioSettings.videoQuality].resolution,
	};
	if (audioSettings.videoDeviceId !== 'default') {
		videoCaptureOpts.deviceId = { exact: audioSettings.videoDeviceId };
	}

	const room = new Room({
		audioCaptureDefaults: audioCaptureOpts,
		videoCaptureDefaults: videoCaptureOpts,
		audioOutput: audioSettings.outputDeviceId !== 'default'
			? { deviceId: audioSettings.outputDeviceId }
			: undefined,
	});

	// Wire up event listeners before connecting so we don't miss early events.
	setupRoomEvents(room);

	await room.connect(livekitUrl, token);

	// Mark connected first (clears participant map), then register participants.
	// Done before enabling mic so events fired during setup aren't wiped.
	setConnected(channel);

	// Enable local microphone with selected device.
	// If push-to-talk is active, start muted to avoid a brief open-mic window.
	const startMuted = audioSettings.pushToTalk;
	if (startMuted) {
		voiceState.localMuted = true;
	} else {
		await room.localParticipant.setMicrophoneEnabled(true, audioCaptureOpts);
	}

	// Add local participant to the map.
	updateParticipant(participantNick(room.localParticipant), {
		isMuted: startMuted || !room.localParticipant.isMicrophoneEnabled,
	});

	// Register existing remote participants (may already be in the room).
	for (const participant of room.remoteParticipants.values()) {
		updateParticipant(participantNick(participant), {
			isMuted: !participant.isMicrophoneEnabled,
		});
	}

	return room;
}

/**
 * Disconnect from a LiveKit room and reset voice state.
 */
export async function disconnectVoice(room: Room): Promise<void> {
	// Disable all local tracks before disconnecting.
	for (const pub of room.localParticipant.trackPublications.values()) {
		if (pub.track) {
			await pub.track.stop();
		}
	}

	await room.disconnect();
	setDisconnected();
}

/**
 * Toggle the local microphone mute state.
 */
export async function toggleMute(room: Room): Promise<void> {
	const willMute = !voiceState.localMuted;
	await room.localParticipant.setMicrophoneEnabled(!willMute);
	toggleMuteState();
	// Sync local participant in the participants map.
	updateParticipant(participantNick(room.localParticipant), {
		isMuted: willMute,
	});
}

/**
 * Toggle deafen: mute all remote audio and also mute local mic.
 *
 * When un-deafening, remote audio is restored. Local mic is only
 * restored if it wasn't independently muted before deafening.
 * The state layer (toggleDeafenState) tracks wasMutedBeforeDeafen.
 */
export async function toggleDeafen(room: Room): Promise<void> {
	const willDeafen = !voiceState.localDeafened;

	// Mute/unmute all remote audio tracks.
	for (const participant of room.remoteParticipants.values()) {
		for (const pub of participant.trackPublications.values()) {
			if (pub.track && pub.track.kind === Track.Kind.Audio) {
				if (willDeafen) {
					(pub.track as any).setVolume?.(0);
					pub.track.detach();
				} else {
					(pub.track as any).setVolume?.(audioSettings.outputVolume / 100);
					pub.track.attach();
				}
			}
		}
	}

	if (willDeafen) {
		await room.localParticipant.setMicrophoneEnabled(false);
	}

	// Update state — toggleDeafenState captures/restores wasMutedBeforeDeafen
	toggleDeafenState();

	// On undeafen, sync LiveKit mic to the restored mute state
	if (!willDeafen) {
		await room.localParticipant.setMicrophoneEnabled(!voiceState.localMuted);
	}

	// Sync local participant in the participants map.
	updateParticipant(participantNick(room.localParticipant), {
		isMuted: voiceState.localMuted,
		isDeafened: voiceState.localDeafened,
	});
}

/**
 * Toggle the local camera video on/off.
 * Respects the selected video device from audioSettings.
 * The actual video track is registered via the LocalTrackPublished event
 * in setupRoomEvents, avoiding race conditions with getTrackPublication.
 */
export async function toggleVideo(room: Room): Promise<void> {
	const willEnable = !voiceState.localVideoEnabled;
	try {
		if (willEnable) {
			const videoOpts: VideoCaptureOptions = {
				resolution: qualityPresets[audioSettings.videoQuality].resolution,
			};
			if (audioSettings.videoDeviceId !== 'default') {
				videoOpts.deviceId = { exact: audioSettings.videoDeviceId };
			}
			await room.localParticipant.setCameraEnabled(true, videoOpts);
		} else {
			await room.localParticipant.setCameraEnabled(false);
		}
		voiceState.localVideoEnabled = willEnable;
		updateParticipant(participantNick(room.localParticipant), {
			hasVideo: willEnable,
		});
	} catch (e) {
		// Permission denied or device error — don't change state
		console.error('[virc] Camera toggle failed:', e);
	}
}

/**
 * Toggle local screen sharing on/off.
 * The actual screen track is registered via the LocalTrackPublished event
 * in setupRoomEvents, avoiding race conditions with getTrackPublication.
 */
export async function toggleScreenShare(room: Room): Promise<void> {
	const willEnable = !voiceState.localScreenShareEnabled;
	try {
		await room.localParticipant.setScreenShareEnabled(willEnable);
		voiceState.localScreenShareEnabled = willEnable;
		updateParticipant(participantNick(room.localParticipant), {
			hasScreenShare: willEnable,
		});
	} catch (e) {
		// User cancelled screen picker or permission denied — don't change state
		console.error('[virc] Screen share toggle failed:', e);
	}
}

/**
 * Determine the track source type for a TrackPublication.
 */
function trackSource(pub: TrackPublication): 'camera' | 'screen' | null {
	if (pub.source === Track.Source.Camera) return 'camera';
	if (pub.source === Track.Source.ScreenShare) return 'screen';
	return null;
}

/**
 * Set up LiveKit room event listeners that sync to voiceState.
 */
function setupRoomEvents(room: Room): void {
	// Apply output volume to newly subscribed audio tracks,
	// and register video tracks in the video grid.
	room.on(
		RoomEvent.TrackSubscribed,
		(track, publication, participant) => {
			if (track.kind === Track.Kind.Audio) {
				(track as any).setVolume?.(audioSettings.outputVolume / 100);
			}
			if (track.kind === Track.Kind.Video && track.mediaStreamTrack) {
				const src = trackSource(publication);
				if (src) {
					addVideoTrack({
						nick: participantNick(participant),
						source: src,
						track: track.mediaStreamTrack,
						sid: publication.trackSid,
					});
					updateParticipant(participantNick(participant), {
						hasVideo: src === 'camera' ? true : undefined,
						hasScreenShare: src === 'screen' ? true : undefined,
					});
				}
			}
		},
	);

	// Remove video tracks when unsubscribed.
	room.on(
		RoomEvent.TrackUnsubscribed,
		(track, publication, participant) => {
			if (track.kind === Track.Kind.Video) {
				removeVideoTrack(publication.trackSid);
				const src = trackSource(publication);
				if (src) {
					updateParticipant(participantNick(participant), {
						hasVideo: src === 'camera' ? false : undefined,
						hasScreenShare: src === 'screen' ? false : undefined,
					});
				}
			}
		},
	);

	room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
		updateParticipant(participantNick(participant), {
			isMuted: !participant.isMicrophoneEnabled,
		});
	});

	room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
		// Remove any video tracks from this participant
		for (const pub of participant.trackPublications.values()) {
			if (pub.track?.kind === Track.Kind.Video) {
				removeVideoTrack(pub.trackSid);
			}
		}
		removeParticipant(participantNick(participant));
	});

	room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
		const speakingNicks = new Set(speakers.map(participantNick));

		// Mark current speakers.
		for (const nick of speakingNicks) {
			updateParticipant(nick, { isSpeaking: true });
		}

		// Clear speaking flag for those no longer speaking.
		for (const [nick, p] of voiceState.participants) {
			if (p.isSpeaking && !speakingNicks.has(nick)) {
				updateParticipant(nick, { isSpeaking: false });
			}
		}
	});

	// Register local video tracks when published (reliable — fires after track is ready).
	room.on(
		RoomEvent.LocalTrackPublished,
		(publication: LocalTrackPublication) => {
			if (publication.track?.kind === Track.Kind.Video && publication.track.mediaStreamTrack) {
				const src = trackSource(publication);
				if (src) {
					addVideoTrack({
						nick: participantNick(room.localParticipant),
						source: src,
						track: publication.track.mediaStreamTrack,
						sid: publication.trackSid,
					});
				}
			}
		},
	);

	// Handle local track being unpublished (e.g. user clicks browser "Stop sharing")
	room.on(
		RoomEvent.LocalTrackUnpublished,
		(publication: LocalTrackPublication) => {
			const src = trackSource(publication);
			if (src === 'screen') {
				removeVideoTrack(publication.trackSid);
				voiceState.localScreenShareEnabled = false;
				updateParticipant(participantNick(room.localParticipant), {
					hasScreenShare: false,
				});
			} else if (src === 'camera') {
				removeVideoTrack(publication.trackSid);
				voiceState.localVideoEnabled = false;
				updateParticipant(participantNick(room.localParticipant), {
					hasVideo: false,
				});
			}
		},
	);

	room.on(
		RoomEvent.TrackMuted,
		(publication: TrackPublication, participant: Participant) => {
			if (publication.kind === Track.Kind.Audio) {
				updateParticipant(participantNick(participant), { isMuted: true });
			}
		},
	);

	room.on(
		RoomEvent.TrackUnmuted,
		(publication: TrackPublication, participant: Participant) => {
			if (publication.kind === Track.Kind.Audio) {
				updateParticipant(participantNick(participant), { isMuted: false });
			}
		},
	);
}
