/**
 * Reactive voice presence state: who is in each voice channel.
 *
 * Populated by polling /api/livekit/rooms. This allows all users to see
 * voice channel participants without being connected themselves.
 *
 * Uses a version counter for Map reactivity (Svelte 5 $state doesn't
 * deeply track Map/Set mutations).
 */

import { getActiveServer } from '$lib/state/servers.svelte';
import { getToken } from '$lib/api/auth';

// --- Internal storage ---
/** Maps channel name (e.g. "#voice-lobby") to array of participant identities. */
const _rooms = new Map<string, string[]>();
let _version = $state(0);

function notify(): void {
	_version++;
}

/** Reactive voice presence — components read this directly. */
export const voicePresence = {
	/** Get participants for a specific channel. */
	get(channel: string): string[] {
		void _version;
		return _rooms.get(channel) ?? [];
	},
	/** Get the full rooms map (for iteration). */
	get rooms() {
		void _version;
		return _rooms;
	},
};

/** Replace all voice presence data from a server response. */
export function setVoicePresence(rooms: Record<string, string[]>): void {
	_rooms.clear();
	for (const [channel, participants] of Object.entries(rooms)) {
		_rooms.set(channel, participants);
	}
	notify();
}

/** Clear all voice presence data. */
export function resetVoicePresence(): void {
	_rooms.clear();
	notify();
}

// --- Polling ---

let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Interval in ms between polls. */
const POLL_INTERVAL = 10_000;

/** Fetch voice room presence from the files server. */
async function fetchPresence(): Promise<void> {
	const server = getActiveServer();
	if (!server?.filesUrl) return;

	const jwt = getToken();
	if (!jwt) return;

	try {
		const res = await fetch(`${server.filesUrl}/api/livekit/rooms`, {
			headers: { Authorization: `Bearer ${jwt}` },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return;
		const data = (await res.json()) as { rooms: Record<string, string[]> };
		setVoicePresence(data.rooms);
	} catch {
		// Network error or timeout — keep stale data rather than clearing
	}
}

/** Start polling voice presence. Safe to call multiple times. */
export function startVoicePresencePolling(): void {
	if (pollTimer) return;
	// Fetch immediately, then on interval
	fetchPresence();
	pollTimer = setInterval(fetchPresence, POLL_INTERVAL);
}

/** Stop polling and clear presence data. */
export function stopVoicePresencePolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	resetVoicePresence();
}

/** Trigger an immediate refresh (e.g. after joining/leaving voice). */
export function refreshVoicePresence(): void {
	fetchPresence();
}
