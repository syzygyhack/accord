/**
 * Voice call management: channel voice rooms, DM voice/video calls.
 *
 * Extracted from chat/+page.svelte to reduce god component size.
 * These functions handle LiveKit token fetching, room connection,
 * and IRC channel joins/parts for voice presence.
 */

import { connectToVoice, disconnectVoice, toggleVideo as toggleVideoRoom } from '$lib/voice/room';
import { voiceState } from '$lib/state/voice.svelte';
import { getActiveServer } from '$lib/state/servers.svelte';
import { getToken } from '$lib/api/auth';
import { join } from '$lib/irc/commands';
import { channelUIState, channelState, addDMConversation } from '$lib/state/channels.svelte';
import { memberState } from '$lib/state/members.svelte';
import { userState } from '$lib/state/user.svelte';
import type { IRCConnection } from '$lib/irc/connection';
import type { Room } from 'livekit-client';

/**
 * Result of a voice connection operation.
 * Returns the Room on success, or an error message string on failure.
 */
export type VoiceResult = { ok: true; room: Room | null } | { ok: false; error: string };

/**
 * Resolve the account name for a DM target nick.
 * Checks DM conversations first, then channel member lists.
 */
export function resolveAccountForNick(target: string): string | null {
	const lowerTarget = target.toLowerCase();

	for (const dm of channelUIState.dmConversations) {
		if (dm.nick.toLowerCase() === lowerTarget && dm.account) {
			return dm.account;
		}
	}

	for (const ch of channelState.channels.values()) {
		for (const member of ch.members.values()) {
			if (member.nick.toLowerCase() === lowerTarget && member.account) {
				addDMConversation(target, member.account);
				return member.account;
			}
		}
	}

	for (const map of memberState.channels.values()) {
		for (const member of map.values()) {
			if (member.nick.toLowerCase() === lowerTarget && member.account) {
				addDMConversation(target, member.account);
				return member.account;
			}
		}
	}

	return null;
}

/**
 * Generate a deterministic room name for a DM voice call.
 * Sorts the two account names alphabetically so both participants get the same room.
 */
export function getDMRoomName(target: string): string {
	const selfAccount = userState.account ?? '';
	if (!selfAccount) {
		throw new Error('Not authenticated');
	}

	const targetAccount = resolveAccountForNick(target);
	if (!targetAccount) {
		throw new Error(`Cannot start DM call until ${target}'s account is known`);
	}

	// Lowercase to match server-side comparison (livekit.ts uses toLowerCase)
	const a = selfAccount.toLowerCase();
	const b = targetAccount.toLowerCase();

	// Account names must not contain colons — the room format is "dm:a:b"
	// and the server splits on ":" expecting exactly 3 parts.
	if (a.includes(':') || b.includes(':')) {
		throw new Error('Account name contains invalid character');
	}

	const accounts = [a, b].sort();
	return `dm:${accounts[0]}:${accounts[1]}`;
}

/** Fetch a LiveKit token from the files server. */
async function fetchVoiceToken(channel: string): Promise<{ token: string; url: string }> {
	const server = getActiveServer();
	if (!server) throw new Error('No active server');
	if (!server.filesUrl) throw new Error('Voice requires a files server');

	const jwt = getToken();
	if (!jwt) throw new Error('Not authenticated');

	const res = await fetch(`${server.filesUrl}/api/livekit/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${jwt}`,
		},
		body: JSON.stringify({ channel }),
	});

	if (!res.ok) {
		throw new Error(`Failed to get voice token (${res.status})`);
	}

	return (await res.json()) as { token: string; url: string };
}

/**
 * Handle a voice channel click: request mic, fetch token, connect, JOIN IRC channel.
 * If already in the channel, disconnects (toggle behavior).
 */
export async function handleVoiceChannelClick(
	channel: string,
	conn: IRCConnection | null,
	currentRoom: Room | null,
	onDisconnected?: (prevRoom: string | null) => void,
): Promise<VoiceResult> {
	// If already in this channel, disconnect (toggle behavior)
	if (voiceState.currentRoom === channel && currentRoom) {
		await disconnectVoice(currentRoom);
		if (conn) conn.send(`PART ${channel}`);
		return { ok: true, room: null };
	}

	// If connected to a different voice channel, disconnect first
	if (currentRoom) {
		const prevChannel = voiceState.currentRoom;
		await disconnectVoice(currentRoom);
		if (conn && prevChannel) {
			conn.send(`PART ${prevChannel}`);
		}
	}

	try {
		// 1. Request microphone permission
		const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of permStream.getTracks()) track.stop();

		// 2. Fetch LiveKit token
		const data = await fetchVoiceToken(channel);

		// 3. Connect to the LiveKit room
		const room = await connectToVoice(channel, data.url, data.token, onDisconnected);

		// 4. JOIN the IRC voice channel for presence
		if (conn) join(conn, [channel]);

		return { ok: true, room };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Voice connection failed: ${msg}` };
	}
}

/**
 * Handle a DM voice call: toggle voice for a 1:1 call.
 * Uses a deterministic room name based on sorted account names.
 */
export async function handleDMVoiceCall(
	target: string,
	conn: IRCConnection | null,
	currentRoom: Room | null,
	onDisconnected?: (prevRoom: string | null) => void,
): Promise<VoiceResult> {
	try {
		const dmRoom = getDMRoomName(target);

		// If already in a DM call with this target, disconnect (toggle)
		if (voiceState.currentRoom === dmRoom && currentRoom) {
			await disconnectVoice(currentRoom);
			return { ok: true, room: null };
		}

		// If in another voice session, disconnect first
		if (currentRoom) {
			const prevChannel = voiceState.currentRoom;
			await disconnectVoice(currentRoom);
			if (conn && prevChannel && (prevChannel.startsWith('#') || prevChannel.startsWith('&'))) {
				conn.send(`PART ${prevChannel}`);
			}
		}

		// Request mic permission
		const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of permStream.getTracks()) track.stop();

		const data = await fetchVoiceToken(dmRoom);
		const room = await connectToVoice(dmRoom, data.url, data.token, onDisconnected);
		return { ok: true, room };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Voice call failed: ${msg}` };
	}
}

/**
 * Handle a DM video call: start voice + enable camera.
 * If already in a call, just toggle the camera.
 */
export async function handleDMVideoCall(
	target: string,
	conn: IRCConnection | null,
	currentRoom: Room | null,
	onDisconnected?: (prevRoom: string | null) => void,
): Promise<VoiceResult> {
	try {
		const dmRoom = getDMRoomName(target);

		// If already in the call, just toggle camera
		if (voiceState.currentRoom === dmRoom && currentRoom) {
			await toggleVideoRoom(currentRoom);
			return { ok: true, room: currentRoom };
		}

		// Not in a call yet — start voice call first, then enable camera
		const result = await handleDMVoiceCall(target, conn, currentRoom, onDisconnected);
		if (result.ok && result.room) {
			await toggleVideoRoom(result.room);
		}
		return result;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `Video call failed: ${msg}` };
	}
}
