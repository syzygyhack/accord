/**
 * Reactive message state with per-channel ring buffers.
 *
 * Each channel/DM target maintains a capped array of messages (max 500).
 * Tracks oldest/newest msgid per channel for CHATHISTORY cursor pagination.
 *
 * Svelte 5's $state proxy does NOT deeply track Map/Set mutations.
 * We use a plain Map for storage and a reactive version counter ($state)
 * that gets bumped on every mutation. Consumers read `version` to
 * subscribe, then access the Map for data.
 */

const MAX_MESSAGES_PER_CHANNEL = 500;

export type MessageType = 'privmsg' | 'join' | 'part' | 'quit' | 'nick' | 'mode';
export type SendState = 'sending' | 'sent' | 'failed';

export interface Message {
	msgid: string;
	nick: string;
	account: string;
	target: string; // channel or nick for DMs
	text: string;
	time: Date;
	tags: Record<string, string>;
	replyTo?: string; // msgid of parent
	reactions: Map<string, Set<string>>; // emoji -> set of accounts
	isRedacted: boolean;
	type: MessageType;
	sendState?: SendState; // only set for locally-sent messages
}

interface ChannelCursors {
	oldestMsgid: string | null;
	newestMsgid: string | null;
}

// --- Internal (non-reactive) storage ---
const channelMessages = new Map<string, Message[]>();
const channelCursors = new Map<string, ChannelCursors>();

// --- Reactive version counter — bump this on every mutation ---
let _version = $state(0);

/** Bump the version to notify all reactive consumers. */
function notify(): void {
	_version++;
}

/** Ensure a channel buffer and cursors entry exist. */
function ensureChannel(target: string): void {
	if (!channelMessages.has(target)) {
		channelMessages.set(target, []);
	}
	if (!channelCursors.has(target)) {
		channelCursors.set(target, { oldestMsgid: null, newestMsgid: null });
	}
}

/** Update cursors after adding messages. */
function updateCursors(target: string): void {
	const msgs = channelMessages.get(target);
	if (!msgs || msgs.length === 0) return;

	const cursors = channelCursors.get(target)!;
	cursors.oldestMsgid = msgs[0].msgid;
	cursors.newestMsgid = msgs[msgs.length - 1].msgid;
}

/** Counter for generating unique local IDs for optimistic messages. */
let _localMsgCounter = 0;

/** Generate a unique local msgid for optimistic messages. */
export function generateLocalMsgid(): string {
	return `_local_${++_localMsgCounter}`;
}

/** Add a message to a channel buffer, evicting the oldest if over capacity. */
export function addMessage(target: string, msg: Message): void {
	ensureChannel(target);
	const msgs = channelMessages.get(target)!;
	msgs.push(msg);

	if (msgs.length > MAX_MESSAGES_PER_CHANNEL) {
		msgs.splice(0, msgs.length - MAX_MESSAGES_PER_CHANNEL);
	}

	updateCursors(target);
	notify();
}

/**
 * Replace an optimistic (local) message with the server-echoed version.
 * Matches by local msgid prefix and same nick+text content.
 * Returns true if a replacement was made.
 */
export function replaceOptimisticMessage(target: string, echoMsg: Message): boolean {
	const msgs = channelMessages.get(target);
	if (!msgs) return false;

	// Find the oldest pending optimistic message from this nick with the same text
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (
			m.msgid.startsWith('_local_') &&
			m.nick === echoMsg.nick &&
			m.text === echoMsg.text
		) {
			// Replace with server-confirmed message
			msgs[i] = echoMsg;
			updateCursors(target);
			notify();
			return true;
		}
	}
	return false;
}

/** Look up a single message by msgid within a channel. */
export function getMessage(target: string, msgid: string): Message | null {
	const msgs = channelMessages.get(target);
	if (!msgs) return null;
	return msgs.find((m) => m.msgid === msgid) ?? null;
}

/**
 * Get all messages for a channel. Returns empty array if channel has no messages.
 * Reads the reactive version counter so $derived/$effect consumers re-run on changes.
 */
export function getMessages(target: string): Message[] {
	// Touch _version so Svelte tracks this as a reactive dependency
	void _version;
	return channelMessages.get(target) ?? [];
}

/** Mark a message as redacted by msgid. */
export function redactMessage(target: string, msgid: string): void {
	const msg = getMessage(target, msgid);
	if (msg) {
		msg.isRedacted = true;
		notify();
	}
}

/** Add a reaction to a message. */
export function addReaction(target: string, msgid: string, emoji: string, account: string): void {
	const msg = getMessage(target, msgid);
	if (!msg) return;

	if (!msg.reactions.has(emoji)) {
		msg.reactions.set(emoji, new Set());
	}
	msg.reactions.get(emoji)!.add(account);
	notify();
}

/** Remove a reaction from a message. */
export function removeReaction(
	target: string,
	msgid: string,
	emoji: string,
	account: string
): void {
	const msg = getMessage(target, msgid);
	if (!msg) return;

	const accounts = msg.reactions.get(emoji);
	if (!accounts) return;

	accounts.delete(account);
	if (accounts.size === 0) {
		msg.reactions.delete(emoji);
	}
	notify();
}

/**
 * Prepend messages to the beginning of a channel buffer (for history loading).
 * Evicts from the end if the total exceeds the max capacity.
 */
export function prependMessages(target: string, msgs: Message[]): void {
	ensureChannel(target);
	const existing = channelMessages.get(target)!;
	const combined = [...msgs, ...existing];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		combined.splice(MAX_MESSAGES_PER_CHANNEL);
	}

	channelMessages.set(target, combined);
	updateCursors(target);
	notify();
}

/**
 * Append messages to the end of a channel buffer (for gap-fill / AFTER history).
 * Evicts from the beginning if the total exceeds the max capacity.
 */
export function appendMessages(target: string, msgs: Message[]): void {
	ensureChannel(target);
	const existing = channelMessages.get(target)!;
	const combined = [...existing, ...msgs];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		combined.splice(0, combined.length - MAX_MESSAGES_PER_CHANNEL);
	}

	channelMessages.set(target, combined);
	updateCursors(target);
	notify();
}

/** Get the CHATHISTORY cursors for a channel. */
export function getCursors(target: string): ChannelCursors {
	// Touch _version for reactivity
	void _version;
	return channelCursors.get(target) ?? { oldestMsgid: null, newestMsgid: null };
}

/** Clear all messages for a channel. */
export function clearChannel(target: string): void {
	channelMessages.delete(target);
	channelCursors.delete(target);
	notify();
}

/** Update the send state of a locally-sent message. */
export function updateSendState(target: string, msgid: string, state: SendState): void {
	const msg = getMessage(target, msgid);
	if (msg) {
		msg.sendState = state;
		notify();
	}
}

/**
 * Signal bumped when a history batch completes (even if the batch was empty).
 * Tracks the target channel so consumers can ignore batches for other channels.
 * Wrapped in an object to satisfy Svelte 5's "no reassigned $state exports" rule.
 */
export const historyBatch = $state({ seq: 0, target: '' });

/** Signal that a CHATHISTORY batch completed (may be empty). */
export function notifyHistoryBatchComplete(target?: string): void {
	historyBatch.seq++;
	historyBatch.target = target ?? '';
}

/** Reset all message state. */
export function resetMessages(): void {
	channelMessages.clear();
	channelCursors.clear();
	notify();
}

// Legacy export — some imports reference messageState.channels / messageState.cursors.
// Provide a getter-based facade so existing code doesn't break.
export const messageState = {
	get channels() { return channelMessages; },
	get cursors() { return channelCursors; },
};
