/**
 * Reactive channel state: members, topics, and loading status.
 *
 * Tracks per-channel membership, topic, and whether the initial NAMES
 * response has been fully received.
 */

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

interface ChannelStore {
	channels: Map<string, ChannelInfo>;
}

/** Reactive channel store — components read this directly. */
export const channelState: ChannelStore = $state({
	channels: new Map(),
});

function ensureChannel(name: string): ChannelInfo {
	if (!channelState.channels.has(name)) {
		channelState.channels.set(name, {
			name,
			topic: '',
			members: new Map(),
			namesLoaded: false,
		});
	}
	return channelState.channels.get(name)!;
}

/** Get channel info, or null if not joined. */
export function getChannel(name: string): ChannelInfo | null {
	return channelState.channels.get(name) ?? null;
}

/** Add a member to a channel. */
export function addMember(channel: string, nick: string, account: string, prefix = ''): void {
	const ch = ensureChannel(channel);
	ch.members.set(nick, { nick, account, prefix });
}

/** Remove a member from a channel. */
export function removeMember(channel: string, nick: string): void {
	const ch = channelState.channels.get(channel);
	if (ch) {
		ch.members.delete(nick);
	}
}

/** Remove a nick from all channels (used for QUIT). */
export function removeMemberFromAll(nick: string): void {
	for (const ch of channelState.channels.values()) {
		ch.members.delete(nick);
	}
}

/** Rename a member across all channels (used for NICK). */
export function renameMember(oldNick: string, newNick: string): void {
	for (const ch of channelState.channels.values()) {
		const member = ch.members.get(oldNick);
		if (member) {
			ch.members.delete(oldNick);
			member.nick = newNick;
			ch.members.set(newNick, member);
		}
	}
}

/** Get all channel names where a nick is a member. */
export function getChannelsForNick(nick: string): string[] {
	const channels: string[] = [];
	for (const ch of channelState.channels.values()) {
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
}

/** Mark a channel's NAMES list as fully received. */
export function setNamesLoaded(channel: string): void {
	const ch = channelState.channels.get(channel);
	if (ch) {
		ch.namesLoaded = true;
	}
}

/** Remove a channel entirely (on PART by self). */
export function removeChannel(name: string): void {
	channelState.channels.delete(name);
}

/** Reset all channel state. */
export function resetChannels(): void {
	channelState.channels.clear();
}

// ---------------------------------------------------------------------------
// UI-level channel state: active channel, categories, DM conversations
// ---------------------------------------------------------------------------

export interface ChannelCategory {
	name: string;
	channels: string[];
	collapsed: boolean;
	voice?: boolean;
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
 */
export function setCategories(cats: Array<{ name: string; channels: string[]; voice?: boolean }>): void {
	channelUIState.categories = cats.map((c) => ({
		name: c.name,
		channels: c.channels,
		collapsed: false,
		voice: c.voice,
	}));
}

/** Toggle a category's collapsed state. */
export function toggleCategory(name: string): void {
	const cat = channelUIState.categories.find((c) => c.name === name);
	if (cat) {
		cat.collapsed = !cat.collapsed;
	}
}

/** Add a DM conversation to the sidebar. */
export function addDMConversation(nick: string, account = '', lastMessage?: string): void {
	const existing = channelUIState.dmConversations.find((d) => d.nick === nick);
	if (existing) {
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
