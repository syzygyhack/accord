/**
 * Reactive message state with per-channel ring buffers.
 *
 * Each channel/DM target maintains a capped array of messages (max 500).
 * Tracks oldest/newest msgid per channel for CHATHISTORY cursor pagination.
 */

const MAX_MESSAGES_PER_CHANNEL = 500;

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
}

interface ChannelCursors {
	oldestMsgid: string | null;
	newestMsgid: string | null;
}

interface MessageStore {
	channels: Map<string, Message[]>;
	cursors: Map<string, ChannelCursors>;
}

/** Reactive message store — components read this directly. */
export const messageState: MessageStore = $state({
	channels: new Map(),
	cursors: new Map(),
});

/** Ensure a channel buffer and cursors entry exist. */
function ensureChannel(target: string): void {
	if (!messageState.channels.has(target)) {
		messageState.channels.set(target, []);
	}
	if (!messageState.cursors.has(target)) {
		messageState.cursors.set(target, { oldestMsgid: null, newestMsgid: null });
	}
}

/** Update cursors after adding messages. */
function updateCursors(target: string): void {
	const msgs = messageState.channels.get(target);
	if (!msgs || msgs.length === 0) return;

	const cursors = messageState.cursors.get(target)!;
	cursors.oldestMsgid = msgs[0].msgid;
	cursors.newestMsgid = msgs[msgs.length - 1].msgid;
}

/** Add a message to a channel buffer, evicting the oldest if over capacity. */
export function addMessage(target: string, msg: Message): void {
	ensureChannel(target);
	const msgs = messageState.channels.get(target)!;
	msgs.push(msg);

	if (msgs.length > MAX_MESSAGES_PER_CHANNEL) {
		msgs.splice(0, msgs.length - MAX_MESSAGES_PER_CHANNEL);
	}

	updateCursors(target);
}

/** Look up a single message by msgid within a channel. */
export function getMessage(target: string, msgid: string): Message | null {
	const msgs = messageState.channels.get(target);
	if (!msgs) return null;
	return msgs.find((m) => m.msgid === msgid) ?? null;
}

/** Get all messages for a channel. Returns empty array if channel has no messages. */
export function getMessages(target: string): Message[] {
	return messageState.channels.get(target) ?? [];
}

/** Mark a message as redacted by msgid. */
export function redactMessage(target: string, msgid: string): void {
	const msg = getMessage(target, msgid);
	if (msg) {
		msg.isRedacted = true;
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
}

/**
 * Prepend messages to the beginning of a channel buffer (for history loading).
 * Evicts from the end if the total exceeds the max capacity.
 */
export function prependMessages(target: string, msgs: Message[]): void {
	ensureChannel(target);
	const existing = messageState.channels.get(target)!;
	const combined = [...msgs, ...existing];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		combined.splice(MAX_MESSAGES_PER_CHANNEL);
	}

	messageState.channels.set(target, combined);
	updateCursors(target);
}

/** Get the CHATHISTORY cursors for a channel. */
export function getCursors(target: string): ChannelCursors {
	return messageState.cursors.get(target) ?? { oldestMsgid: null, newestMsgid: null };
}

/** Clear all messages for a channel. */
export function clearChannel(target: string): void {
	messageState.channels.delete(target);
	messageState.cursors.delete(target);
}

/** Reset all message state. */
export function resetMessages(): void {
	messageState.channels.clear();
	messageState.cursors.clear();
}
