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

import { hasLocalStorage } from '$lib/utils/storage';
import {
	cacheMessage as idbCacheMessage,
	cacheMessages as idbCacheMessages,
	clearCachedChannel as idbClearChannel,
	clearAllCachedMessages as idbClearAll,
	serializeMessage,
	loadCachedMessages as idbLoadMessages,
	deserializeMessage,
} from '$lib/cache/messageCache';

const MAX_MESSAGES_PER_CHANNEL = 500;

/**
 * Normalize a channel/nick target for use as a Map key.
 * IRC channel names and nicks are case-insensitive, so we lowercase
 * for storage while preserving original casing in Message.target for display.
 */
function normalizeTarget(target: string): string {
	return target.toLowerCase();
}

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
	threadId?: string; // computed: the root message's msgid for this thread
	reactions: Map<string, Set<string>>; // emoji -> set of accounts
	isRedacted: boolean;
	isEdited?: boolean; // true when message has been updated via +accord/edit
	editHistory?: string[]; // previous text values, newest last
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
	if (!hasLocalStorage()) return;
	try {
		const raw = localStorage.getItem(PINNED_STORAGE_KEY);
		if (!raw) return;
		const data = JSON.parse(raw) as Record<string, string[]>;
		for (const [channel, msgids] of Object.entries(data)) {
			pinnedMessages.set(normalizeTarget(channel), new Set(msgids));
		}
	} catch {
		// Corrupted data — ignore
	}
}

/** Persist pinned messages to localStorage. */
function savePinnedMessages(): void {
	if (!hasLocalStorage()) return;
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

// --- IndexedDB write-through (fire-and-forget) ---

/** Whether IndexedDB caching is available (disabled in tests/SSR). */
let _idbEnabled = typeof indexedDB !== 'undefined';

/** Disable IDB caching (for tests). */
export function disableIdbCache(): void { _idbEnabled = false; }

/** Enable IDB caching. */
export function enableIdbCache(): void { _idbEnabled = typeof indexedDB !== 'undefined'; }

/** Fire-and-forget cache write. Swallows errors silently. */
function idbWrite(fn: () => Promise<void>): void {
	if (!_idbEnabled) return;
	fn().catch(() => {});
}

// --- Reactive version counter — bump this on every mutation ---
let _version = $state(0);

/** Bump the version to notify all reactive consumers. */
function notify(): void {
	_version++;
}

/** Ensure a channel buffer and cursors entry exist. Key is already normalized. */
function ensureChannel(key: string): void {
	if (!channelMessages.has(key)) {
		channelMessages.set(key, []);
	}
	if (!channelCursors.has(key)) {
		channelCursors.set(key, { oldestMsgid: null, newestMsgid: null });
	}
}

/** Update cursors after adding messages. Key is already normalized. */
function updateCursors(key: string): void {
	const msgs = channelMessages.get(key);
	if (!msgs || msgs.length === 0) return;

	const cursors = channelCursors.get(key)!;
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
	// Compute threadId from reply chain if this message is a reply
	if (msg.replyTo && !msg.threadId) {
		msg.threadId = getThreadRoot(target, msg.replyTo);
	}

	const key = normalizeTarget(target);
	ensureChannel(key);
	const msgs = channelMessages.get(key)!;

	// Deduplicate by msgid — skip if this exact message is already in the buffer.
	// This handles self-DMs (server sends echo + delivery with the same msgid)
	// and any other case where the server delivers the same message twice.
	if (!msg.msgid.startsWith('_local_') && msgs.some((m) => m.msgid === msg.msgid)) {
		return;
	}

	msgs.push(msg);

	if (msgs.length > MAX_MESSAGES_PER_CHANNEL) {
		const evicted = msgs.splice(0, msgs.length - MAX_MESSAGES_PER_CHANNEL);
		// Prune editMap entries for evicted messages to prevent unbounded growth
		for (const m of evicted) {
			editMap.delete(m.msgid);
		}
	}

	updateCursors(key);
	notify();

	// Write-through to IndexedDB (skip local/optimistic messages)
	if (!msg.msgid.startsWith('_local_')) {
		idbWrite(() => idbCacheMessage(serializeMessage(msg, key)));
	}
}

/**
 * Replace an optimistic (local) message with the server-echoed version.
 * Matches by local msgid prefix and same nick+text content.
 * Returns true if a replacement was made.
 */
export function replaceOptimisticMessage(target: string, echoMsg: Message): boolean {
	const msgs = channelMessages.get(normalizeTarget(target));
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
			const key = normalizeTarget(target);
			updateCursors(key);
			notify();

			// Persist the server-confirmed message to IDB
			idbWrite(() => idbCacheMessage(serializeMessage(echoMsg, key)));
			return true;
		}
	}
	return false;
}

/** Look up a single message by msgid within a channel. */
export function getMessage(target: string, msgid: string): Message | null {
	// Touch _version so Svelte tracks this as a reactive dependency
	void _version;
	const msgs = channelMessages.get(normalizeTarget(target));
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
	return channelMessages.get(normalizeTarget(target)) ?? [];
}

/** Mark a message as redacted by msgid. */
export function redactMessage(target: string, msgid: string): void {
	const msg = getMessage(target, msgid);
	if (msg) {
		msg.isRedacted = true;
		notify();

		const key = normalizeTarget(target);
		idbWrite(() => idbCacheMessage(serializeMessage(msg, key)));
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

	// Preserve previous text in edit history before overwriting
	if (!msg.editHistory) {
		msg.editHistory = [];
	}
	msg.editHistory.push(msg.text);

	msg.text = newText;
	msg.isEdited = true;
	editMap.set(originalMsgid, newMsgid);
	notify();

	const key = normalizeTarget(target);
	idbWrite(() => idbCacheMessage(serializeMessage(msg, key)));
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

	const key = normalizeTarget(target);
	idbWrite(() => idbCacheMessage(serializeMessage(msg, key)));
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

	const key = normalizeTarget(target);
	idbWrite(() => idbCacheMessage(serializeMessage(msg, key)));
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
	const key = normalizeTarget(target);
	ensureChannel(key);
	const existing = channelMessages.get(key)!;
	const combined = [...msgs, ...existing];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		// Drop newest (from the end) — user is scrolling up, keep visible history
		combined.length = MAX_MESSAGES_PER_CHANNEL;
	}

	channelMessages.set(key, combined);
	updateCursors(key);
	notify();

	// Snapshot entire channel buffer to IDB
	idbWrite(() => idbCacheMessages(key, combined.map((m) => serializeMessage(m, key))));
}

/**
 * Append messages to the end of a channel buffer (for gap-fill / AFTER history).
 * Evicts from the beginning if the total exceeds the max capacity.
 */
export function appendMessages(target: string, msgs: Message[]): void {
	const key = normalizeTarget(target);
	ensureChannel(key);
	const existing = channelMessages.get(key)!;
	const combined = [...existing, ...msgs];

	if (combined.length > MAX_MESSAGES_PER_CHANNEL) {
		combined.splice(0, combined.length - MAX_MESSAGES_PER_CHANNEL);
	}

	channelMessages.set(key, combined);
	updateCursors(key);
	notify();

	// Snapshot entire channel buffer to IDB
	idbWrite(() => idbCacheMessages(key, combined.map((m) => serializeMessage(m, key))));
}

/** Get the CHATHISTORY cursors for a channel. */
export function getCursors(target: string): ChannelCursors {
	// Touch _version for reactivity
	void _version;
	return channelCursors.get(normalizeTarget(target)) ?? { oldestMsgid: null, newestMsgid: null };
}

/** Clear all messages for a channel. Also prunes edit map entries for that channel. */
export function clearChannel(target: string): void {
	const key = normalizeTarget(target);
	// Prune edit map entries for messages in this channel before deleting
	const msgs = channelMessages.get(key);
	if (msgs) {
		const msgids = new Set(msgs.map((m) => m.msgid));
		for (const [originalId] of editMap) {
			if (msgids.has(originalId)) {
				editMap.delete(originalId);
			}
		}
	}
	channelMessages.delete(key);
	channelCursors.delete(key);
	notify();

	idbWrite(() => idbClearChannel(key));
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
	const key = normalizeTarget(target);
	if (!pinnedMessages.has(key)) {
		pinnedMessages.set(key, new Set());
	}
	pinnedMessages.get(key)!.add(msgid);
	savePinnedMessages();
	notify();
}

/** Unpin a message in a channel. */
export function unpinMessage(target: string, msgid: string): void {
	const key = normalizeTarget(target);
	const pinned = pinnedMessages.get(key);
	if (!pinned) return;
	pinned.delete(msgid);
	if (pinned.size === 0) {
		pinnedMessages.delete(key);
	}
	savePinnedMessages();
	notify();
}

/** Get the set of pinned message IDs for a channel. */
export function getPinnedMessages(target: string): Set<string> {
	// Touch _version for reactivity
	void _version;
	return pinnedMessages.get(normalizeTarget(target)) ?? new Set();
}

/** Check if a message is pinned in a channel. */
export function isPinned(target: string, msgid: string): boolean {
	// Touch _version for reactivity
	void _version;
	return pinnedMessages.get(normalizeTarget(target))?.has(msgid) ?? false;
}

/** Regex for detecting URLs in message text. */
const URL_RE = /https?:\/\/[^\s<>)"']+/i;

/** Regex for detecting image URLs by file extension. */
const IMAGE_URL_RE = /https?:\/\/[^\s<>)"']+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>)"']*)?/i;

/**
 * Search messages in a channel buffer by text content.
 * Supports filters:
 *   from:username     — filter by nick (case-insensitive)
 *   in:#channel       — search in a different channel instead
 *   has:image         — filter to messages containing image URLs
 *   has:link          — filter to messages containing URLs
 *   before:YYYY-MM-DD — filter to messages before a date
 *   after:YYYY-MM-DD  — filter to messages after a date
 *
 * Only searches privmsg type messages and excludes redacted messages.
 * Returns matching messages in buffer order.
 */
export function searchMessages(defaultChannel: string, query: string): Message[] {
	// Touch _version so Svelte tracks this as a reactive dependency
	void _version;
	const trimmed = query.trim();
	if (!trimmed) return [];

	let channel = defaultChannel;
	let fromFilter: string | null = null;
	let hasImage = false;
	let hasLink = false;
	let beforeDate: Date | null = null;
	let afterDate: Date | null = null;
	const textParts: string[] = [];

	// Parse filters from query tokens
	for (const token of trimmed.split(/\s+/)) {
		const lower = token.toLowerCase();
		if (lower.startsWith('in:')) {
			channel = token.slice(3);
		} else if (lower.startsWith('from:')) {
			fromFilter = token.slice(5).toLowerCase();
		} else if (lower === 'has:image') {
			hasImage = true;
		} else if (lower === 'has:link') {
			hasLink = true;
		} else if (lower.startsWith('before:')) {
			const d = new Date(token.slice(7));
			if (!isNaN(d.getTime())) beforeDate = d;
		} else if (lower.startsWith('after:')) {
			const d = new Date(token.slice(6));
			if (!isNaN(d.getTime())) afterDate = d;
		} else {
			textParts.push(token);
		}
	}

	const textQuery = textParts.join(' ').toLowerCase();
	const msgs = channelMessages.get(normalizeTarget(channel));
	if (!msgs) return [];

	return msgs.filter((m) => {
		if (m.type !== 'privmsg') return false;
		if (m.isRedacted) return false;
		if (fromFilter && m.nick.toLowerCase() !== fromFilter) return false;
		if (textQuery && !m.text.toLowerCase().includes(textQuery)) return false;
		if (hasImage && !IMAGE_URL_RE.test(m.text)) return false;
		if (hasLink && !URL_RE.test(m.text)) return false;
		if (beforeDate && m.time >= beforeDate) return false;
		if (afterDate && m.time <= afterDate) return false;
		return true;
	});
}

// ---------------------------------------------------------------------------
// Thread functions — group messages by reply chains
// ---------------------------------------------------------------------------

/**
 * Walk up the reply chain to find the root message id.
 * If the message has no replyTo or its parent doesn't exist in the buffer,
 * returns the given msgid itself (it is the root).
 */
export function getThreadRoot(target: string, msgid: string): string {
	// Touch _version so Svelte tracks this as a reactive dependency
	void _version;
	const msgs = channelMessages.get(normalizeTarget(target));
	if (!msgs) return msgid;

	let current = msgid;
	const visited = new Set<string>();
	for (let i = 0; i < 100; i++) {
		if (visited.has(current)) break; // cycle guard
		visited.add(current);
		const msg = msgs.find((m) => m.msgid === current);
		if (!msg || !msg.replyTo) break;
		current = msg.replyTo;
	}
	return current;
}

/**
 * Collect all messages in a thread rooted at the given message id.
 * Returns the root message first, followed by all replies (direct and indirect)
 * in chronological order.
 */
export function getThread(target: string, rootMsgId: string): Message[] {
	// Touch _version so Svelte tracks this as a reactive dependency
	void _version;
	const msgs = channelMessages.get(normalizeTarget(target));
	if (!msgs) return [];

	// Build a set of all msgids that belong to this thread
	const threadMsgIds = new Set<string>();
	threadMsgIds.add(rootMsgId);

	// Multi-pass: keep scanning until no new messages are added
	let changed = true;
	while (changed) {
		changed = false;
		for (const m of msgs) {
			if (threadMsgIds.has(m.msgid)) continue;
			if (m.replyTo && threadMsgIds.has(m.replyTo)) {
				threadMsgIds.add(m.msgid);
				changed = true;
			}
		}
	}

	// Return messages in buffer order (chronological)
	return msgs.filter((m) => threadMsgIds.has(m.msgid));
}

/**
 * Count the number of replies in a thread (excludes the root message itself).
 */
export function getThreadCount(target: string, rootMsgId: string): number {
	const thread = getThread(target, rootMsgId);
	// Subtract the root message
	return Math.max(0, thread.length - 1);
}

/**
 * Check if a message has any replies (is a thread root or part of a thread).
 */
export function hasThread(target: string, msgid: string): boolean {
	void _version;
	const msgs = channelMessages.get(normalizeTarget(target));
	if (!msgs) return false;
	return msgs.some((m) => m.replyTo === msgid);
}

/** Reset all message state. */
export function resetMessages(): void {
	channelMessages.clear();
	channelCursors.clear();
	editMap.clear();
	pinnedMessages.clear();
	savePinnedMessages();
	notify();

	idbWrite(() => idbClearAll());
}

/**
 * Hydrate message buffers from IndexedDB cache.
 * Called once on app load before the IRC connection is established.
 * Returns the list of channels that were hydrated.
 */
export async function hydrateFromCache(): Promise<string[]> {
	if (!_idbEnabled) return [];

	try {
		const { getCachedChannels } = await import('$lib/cache/messageCache');
		const channels = await getCachedChannels();
		const hydrated: string[] = [];

		for (const channel of channels) {
			const cached = await idbLoadMessages(channel);
			if (cached.length === 0) continue;

			const msgs: Message[] = cached.map((c) => {
				const base = deserializeMessage(c);
				return {
					...base,
					type: base.type as MessageType,
				};
			});

			ensureChannel(channel);
			channelMessages.set(channel, msgs);
			updateCursors(channel);
			hydrated.push(channel);
		}

		if (hydrated.length > 0) {
			notify();
		}

		return hydrated;
	} catch {
		return [];
	}
}
