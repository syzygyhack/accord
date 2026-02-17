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
	isEdited?: boolean; // true when message has been updated via +accord/edit
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

/**
 * Edit chain map: original msgid -> latest edit msgid.
 * Used so reactions/replies referencing the original msgid still resolve
 * to the correct (edited) message.
 */
const editMap = new Map<string, string>();

// --- Pinned messages (per-channel, client-side with localStorage) ---
const PINNED_STORAGE_KEY = 'accord:pinnedMessages';

/** Per-channel pinned message IDs. */
const pinnedMessages = new Map<string, Set<string>>();

/** Load pinned messages from localStorage on init. */
function loadPinnedMessages(): void {
	try {
		const raw = localStorage.getItem(PINNED_STORAGE_KEY);
		if (!raw) return;
		const data = JSON.parse(raw) as Record<string, string[]>;
		for (const [channel, msgids] of Object.entries(data)) {
			pinnedMessages.set(channel, new Set(msgids));
		}
	} catch {
		// Corrupted data — ignore
	}
}

/** Persist pinned messages to localStorage. */
function savePinnedMessages(): void {
	const data: Record<string, string[]> = {};
	for (const [channel, msgids] of pinnedMessages) {
		if (msgids.size > 0) {
			data[channel] = [...msgids];
		}
	}
	try {
		localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(data));
	} catch {
		// Storage full or unavailable — ignore
	}
}

// Load on module init
loadPinnedMessages();

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
		const evicted = msgs.splice(0, msgs.length - MAX_MESSAGES_PER_CHANNEL);
		// Prune editMap entries for evicted messages to prevent unbounded growth
		for (const m of evicted) {
			editMap.delete(m.msgid);
		}
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

/**
 * Update a message's text in-place (for +accord/edit).
 * Stores the edit chain mapping so reactions/replies to the original msgid still resolve.
 * Returns true if the original message was found and updated.
 */
export function updateMessageText(target: string, originalMsgid: string, newText: string, newMsgid: string): boolean {
	const msg = getMessage(target, originalMsgid);
	if (!msg) return false;

	msg.text = newText;
	msg.isEdited = true;
	editMap.set(originalMsgid, newMsgid);
	notify();
	return true;
}

/**
 * Resolve an edit chain: given a msgid, follow the chain to the latest edit msgid.
 * If the msgid has no edit chain, returns the input msgid unchanged.
 */
export function resolveEditChain(msgid: string): string {
	let current = msgid;
	// Follow the chain (with a safety limit to prevent infinite loops)
	for (let i = 0; i < 50; i++) {
		const next = editMap.get(current);
		if (!next || next === current) break;
		current = next;
	}
	return current;
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
 * When the combined length exceeds max capacity, trims from the end (newest)
 * since the user is scrolling up to view older history.
 *
 * Note (CR-060): The spread copies here are O(n) for n <= MAX_MESSAGES_PER_CHANNEL (500).
 * At this scale the allocation is sub-millisecond and not a bottleneck.
 */
export function prependMessages(target: string, msgs: Message[]): void {
	ensureChannel(target);
	const existing = channelMessages.get(target)!;
	const combined = [...msgs, ...existing];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		// Drop newest (from the end) — user is scrolling up, keep visible history
		combined.length = MAX_MESSAGES_PER_CHANNEL;
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

/** Clear all messages for a channel. Also prunes edit map entries for that channel. */
export function clearChannel(target: string): void {
	// Prune edit map entries for messages in this channel before deleting
	const msgs = channelMessages.get(target);
	if (msgs) {
		const msgids = new Set(msgs.map((m) => m.msgid));
		for (const [originalId] of editMap) {
			if (msgids.has(originalId)) {
				editMap.delete(originalId);
			}
		}
	}
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

/** Pin a message in a channel. */
export function pinMessage(target: string, msgid: string): void {
	if (!pinnedMessages.has(target)) {
		pinnedMessages.set(target, new Set());
	}
	pinnedMessages.get(target)!.add(msgid);
	savePinnedMessages();
	notify();
}

/** Unpin a message in a channel. */
export function unpinMessage(target: string, msgid: string): void {
	const pinned = pinnedMessages.get(target);
	if (!pinned) return;
	pinned.delete(msgid);
	if (pinned.size === 0) {
		pinnedMessages.delete(target);
	}
	savePinnedMessages();
	notify();
}

/** Get the set of pinned message IDs for a channel. */
export function getPinnedMessages(target: string): Set<string> {
	// Touch _version for reactivity
	void _version;
	return pinnedMessages.get(target) ?? new Set();
}

/** Check if a message is pinned in a channel. */
export function isPinned(target: string, msgid: string): boolean {
	// Touch _version for reactivity
	void _version;
	return pinnedMessages.get(target)?.has(msgid) ?? false;
}

/**
 * Search messages in a channel buffer by text content.
 * Supports filters:
 *   from:username — filter by nick (case-insensitive)
 *   in:#channel   — search in a different channel instead
 *
 * Only searches privmsg type messages and excludes redacted messages.
 * Returns matching messages in buffer order.
 */
export function searchMessages(defaultChannel: string, query: string): Message[] {
	const trimmed = query.trim();
	if (!trimmed) return [];

	let channel = defaultChannel;
	let fromFilter: string | null = null;
	const textParts: string[] = [];

	// Parse filters from query tokens
	for (const token of trimmed.split(/\s+/)) {
		if (token.toLowerCase().startsWith('in:')) {
			channel = token.slice(3);
		} else if (token.toLowerCase().startsWith('from:')) {
			fromFilter = token.slice(5).toLowerCase();
		} else {
			textParts.push(token);
		}
	}

	const textQuery = textParts.join(' ').toLowerCase();
	const msgs = channelMessages.get(channel);
	if (!msgs) return [];

	return msgs.filter((m) => {
		if (m.type !== 'privmsg') return false;
		if (m.isRedacted) return false;
		if (fromFilter && m.nick.toLowerCase() !== fromFilter) return false;
		if (textQuery && !m.text.toLowerCase().includes(textQuery)) return false;
		return true;
	});
}

/** Reset all message state. */
export function resetMessages(): void {
	channelMessages.clear();
	channelCursors.clear();
	editMap.clear();
	pinnedMessages.clear();
	savePinnedMessages();
	notify();
}
