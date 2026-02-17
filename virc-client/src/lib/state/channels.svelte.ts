/**
 * Reactive channel state: members, topics, and loading status.
 *
 * Tracks per-channel membership, topic, and whether the initial NAMES
 * response has been fully received.
 *
 * Uses a version counter for Map reactivity (Svelte 5 $state doesn't
 * deeply track Map/Set mutations).
 */

import { hasLocalStorage } from '$lib/utils/storage';

export interface ChannelMember {
	nick: string;
	account: string;
	prefix: string; // mode prefix chars like '@', '+', etc.
}

export interface ChannelInfo {
	name: string;
	topic: string;
	members: Map<string, ChannelMember>; // nick -> member
	namesLoaded: boolean;
}

// --- Internal storage (non-reactive) ---
const _channels = new Map<string, ChannelInfo>();
let _version = $state(0);

function notify(): void {
	_version++;
}

// Legacy export for direct access (e.g. ChannelSidebar iterating keys)
export const channelState = {
	get channels() { void _version; return _channels; },
};

function ensureChannel(name: string): ChannelInfo {
	if (!_channels.has(name)) {
		_channels.set(name, {
			name,
			topic: '',
			members: new Map(),
			namesLoaded: false,
		});
	}
	return _channels.get(name)!;
}

/** Get channel info, or null if not joined. */
export function getChannel(name: string): ChannelInfo | null {
	void _version;
	return _channels.get(name) ?? null;
}

/** Add a member to a channel. */
export function addMember(channel: string, nick: string, account: string, prefix = ''): void {
	const ch = ensureChannel(channel);
	ch.members.set(nick, { nick, account, prefix });
	notify();
}

/** Remove a member from a channel. */
export function removeMember(channel: string, nick: string): void {
	const ch = _channels.get(channel);
	if (ch) {
		ch.members.delete(nick);
		notify();
	}
}

/** Remove a nick from all channels (used for QUIT). */
export function removeMemberFromAll(nick: string): void {
	for (const ch of _channels.values()) {
		ch.members.delete(nick);
	}
	notify();
}

/** Rename a member across all channels (used for NICK). */
export function renameMember(oldNick: string, newNick: string): void {
	for (const ch of _channels.values()) {
		const member = ch.members.get(oldNick);
		if (member) {
			ch.members.delete(oldNick);
			member.nick = newNick;
			ch.members.set(newNick, member);
		}
	}
	notify();
}

/** Get all channel names where a nick is a member. */
export function getChannelsForNick(nick: string): string[] {
	void _version;
	const channels: string[] = [];
	for (const ch of _channels.values()) {
		if (ch.members.has(nick)) {
			channels.push(ch.name);
		}
	}
	return channels;
}

/** Set the topic for a channel. */
export function setTopic(channel: string, topic: string): void {
	const ch = ensureChannel(channel);
	ch.topic = topic;
	notify();
}

/** Mark a channel's NAMES list as fully received. */
export function setNamesLoaded(channel: string): void {
	const ch = _channels.get(channel);
	if (ch) {
		ch.namesLoaded = true;
		notify();
	}
}

/** Clear all members from a channel and reset namesLoaded (for reconnect). */
export function clearChannelMembers(name: string): void {
	const ch = _channels.get(name);
	if (ch) {
		ch.members.clear();
		ch.namesLoaded = false;
		notify();
	}
}

/** Remove a channel entirely (on PART by self). */
export function removeChannel(name: string): void {
	_channels.delete(name);
	notify();
}

/** Reset all channel state. */
export function resetChannels(): void {
	_channels.clear();
	notify();
}

// ---------------------------------------------------------------------------
// Channel order persistence (localStorage)
// ---------------------------------------------------------------------------

const CHANNEL_ORDER_KEY = 'accord:channelOrder';

/**
 * Load saved channel order from localStorage.
 * Returns a map of category name -> ordered channel list.
 */
function loadChannelOrder(): Record<string, string[]> {
	if (!hasLocalStorage()) return {};
	try {
		const stored = localStorage.getItem(CHANNEL_ORDER_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch {
		// Corrupt localStorage — ignore
	}
	return {};
}

/** Persist current channel order to localStorage. */
function saveChannelOrder(): void {
	if (!hasLocalStorage()) return;
	try {
		const order: Record<string, string[]> = {};
		for (const cat of channelUIState.categories) {
			order[cat.name] = [...cat.channels];
		}
		localStorage.setItem(CHANNEL_ORDER_KEY, JSON.stringify(order));
	} catch {
		// Storage full or unavailable — ignore
	}
}

/** Clear persisted channel order from localStorage. */
export function resetChannelOrder(): void {
	if (hasLocalStorage()) {
		localStorage.removeItem(CHANNEL_ORDER_KEY);
	}
}

// ---------------------------------------------------------------------------
// UI-level channel state: active channel, categories, DM conversations
// ---------------------------------------------------------------------------

export interface ChannelCategory {
	name: string;
	channels: string[];
	collapsed: boolean;
	voice?: boolean;
	isReadonly?: boolean;
}

export interface DMConversation {
	nick: string;
	account: string;
	lastMessage?: string;
	lastTime?: Date;
}

interface ChannelUIStore {
	activeChannel: string | null;
	categories: ChannelCategory[];
	dmConversations: DMConversation[];
}

/** Reactive UI state for sidebar — components read this directly. */
export const channelUIState: ChannelUIStore = $state({
	activeChannel: null,
	categories: [],
	dmConversations: [],
});

/** Set the active channel. */
export function setActiveChannel(name: string | null): void {
	channelUIState.activeChannel = name;
}

/** Get the active channel name, or null. */
export function getActiveChannel(): string | null {
	return channelUIState.activeChannel;
}

/**
 * Set categories from virc.json. Each category starts expanded.
 * Applies any saved channel order from localStorage.
 */
export function setCategories(cats: Array<{ name: string; channels: string[]; voice?: boolean; readonly?: boolean }>): void {
	const savedOrder = loadChannelOrder();
	channelUIState.categories = cats.map((c) => {
		let channels = c.channels;
		const saved = savedOrder[c.name];
		if (saved) {
			// Use saved order, but only for channels that still exist in the category.
			// Append any new channels not in the saved order at the end.
			const savedSet = new Set(saved);
			const currentSet = new Set(c.channels);
			const ordered = saved.filter((ch) => currentSet.has(ch));
			const newChannels = c.channels.filter((ch) => !savedSet.has(ch));
			channels = [...ordered, ...newChannels];
		}
		return {
			name: c.name,
			channels,
			collapsed: false,
			voice: c.voice,
			isReadonly: c.readonly,
		};
	});
}

/** Toggle a category's collapsed state. */
export function toggleCategory(name: string): void {
	const cat = channelUIState.categories.find((c) => c.name === name);
	if (cat) {
		cat.collapsed = !cat.collapsed;
	}
}

/**
 * Reorder a channel within a category by moving it from one index to another.
 * Persists the new order to localStorage.
 */
export function reorderChannels(categoryName: string, fromIndex: number, toIndex: number): void {
	const cat = channelUIState.categories.find((c) => c.name === categoryName);
	if (!cat) return;
	const channels = cat.channels;
	if (fromIndex < 0 || fromIndex >= channels.length) return;
	if (toIndex < 0 || toIndex >= channels.length) return;
	if (fromIndex === toIndex) return;
	const [moved] = channels.splice(fromIndex, 1);
	channels.splice(toIndex, 0, moved);
	saveChannelOrder();
}

/** Add a DM conversation to the sidebar. Case-insensitive nick matching per IRC RFC 2812. */
export function addDMConversation(nick: string, account = '', lastMessage?: string): void {
	const nickLower = nick.toLowerCase();
	const existing = channelUIState.dmConversations.find((d) => d.nick.toLowerCase() === nickLower);
	if (existing) {
		// Update the stored nick casing to the most recent form
		existing.nick = nick;
		if (lastMessage !== undefined) {
			existing.lastMessage = lastMessage;
			existing.lastTime = new Date();
		}
		if (account) existing.account = account;
	} else {
		channelUIState.dmConversations.push({
			nick,
			account,
			lastMessage,
			lastTime: lastMessage ? new Date() : undefined,
		});
	}
	// Keep DMs sorted by most recent message first
	sortDMConversations();
}

/**
 * Open a DM conversation: add to the list if not present, then set as active channel.
 */
export function openDM(nick: string, account = ''): void {
	addDMConversation(nick, account);
	setActiveChannel(nick);
}

/**
 * Update the last message for a DM conversation and re-sort.
 * Called by the message handler on incoming DMs.
 */
export function updateDMLastMessage(nick: string, account: string, lastMessage: string): void {
	addDMConversation(nick, account, lastMessage);
}

/** Sort DM conversations by most recent message (newest first). */
function sortDMConversations(): void {
	channelUIState.dmConversations.sort((a, b) => {
		const timeA = a.lastTime?.getTime() ?? 0;
		const timeB = b.lastTime?.getTime() ?? 0;
		return timeB - timeA;
	});
}

/**
 * Check if a target is a DM (not a channel).
 * Channels start with # or &; everything else is a DM nick.
 */
export function isDMTarget(target: string): boolean {
	return !target.startsWith('#') && !target.startsWith('&');
}

/** Reset UI state. */
export function resetChannelUI(): void {
	channelUIState.activeChannel = null;
	channelUIState.categories.length = 0;
	channelUIState.dmConversations.length = 0;
}
