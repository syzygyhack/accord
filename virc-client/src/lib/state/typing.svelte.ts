/**
 * Reactive typing indicator state.
 *
 * Tracks which users are currently typing in each channel/DM target.
 * Typing state expires after TYPING_TIMEOUT_MS without a fresh signal.
 */

const TYPING_TIMEOUT_MS = 6_000;

interface TypingStore {
	/** channel -> nick -> last-seen timestamp (ms) */
	channels: Map<string, Map<string, number>>;
}

/** Reactive typing store — components read this directly. */
export const typingState: TypingStore = $state({
	channels: new Map(),
});

/** Mark a user as typing in a channel. Resets their expiry timer. */
export function setTyping(channel: string, nick: string): void {
	if (!typingState.channels.has(channel)) {
		typingState.channels.set(channel, new Map());
	}
	typingState.channels.get(channel)!.set(nick, Date.now());
}

/** Explicitly clear a user's typing state (e.g. on +typing=done or message sent). */
export function clearTyping(channel: string, nick: string): void {
	const channelMap = typingState.channels.get(channel);
	if (channelMap) {
		channelMap.delete(nick);
		if (channelMap.size === 0) {
			typingState.channels.delete(channel);
		}
	}
}

/**
 * Get the list of nicks currently typing in a channel.
 * Filters out entries older than TYPING_TIMEOUT_MS and cleans them up.
 */
export function getTypingUsers(channel: string): string[] {
	const channelMap = typingState.channels.get(channel);
	if (!channelMap) return [];

	const now = Date.now();
	const active: string[] = [];

	for (const [nick, timestamp] of channelMap) {
		if (now - timestamp < TYPING_TIMEOUT_MS) {
			active.push(nick);
		} else {
			channelMap.delete(nick);
		}
	}

	if (channelMap.size === 0) {
		typingState.channels.delete(channel);
	}

	return active;
}

/** Reset all typing state. */
export function resetTyping(): void {
	typingState.channels.clear();
}
