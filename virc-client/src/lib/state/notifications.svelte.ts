/**
 * Reactive notification state: unread counts, mention counts, and read markers.
 *
 * Per-channel tracking of unread messages and @mentions.
 * Read markers are synced via MARKREAD IRC command.
 * Per-channel notification levels: all | mentions | nothing | mute.
 */

import { hasLocalStorage } from '$lib/utils/storage';

export type NotificationLevel = 'all' | 'mentions' | 'nothing' | 'mute';

const NOTIFICATION_LEVELS_KEY = 'accord:notificationLevels';

interface ChannelNotification {
	unreadCount: number;
	mentionCount: number;
	lastReadMsgid: string | null;
}

interface NotificationStore {
	channels: Map<string, ChannelNotification>;
}

/** Per-channel notification level overrides (non-default only). */
const notificationLevels: Map<string, NotificationLevel> = new Map();

/** Load notification levels from localStorage. */
function loadNotificationLevels(): void {
	if (!hasLocalStorage()) return;
	try {
		const stored = localStorage.getItem(NOTIFICATION_LEVELS_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as Record<string, NotificationLevel>;
			for (const [channel, level] of Object.entries(parsed)) {
				notificationLevels.set(channel, level);
			}
		}
	} catch {
		// Corrupt localStorage — ignore
	}
}

/** Persist notification levels to localStorage. */
function saveNotificationLevels(): void {
	if (!hasLocalStorage()) return;
	try {
		if (notificationLevels.size === 0) {
			localStorage.removeItem(NOTIFICATION_LEVELS_KEY);
			return;
		}
		const obj: Record<string, NotificationLevel> = {};
		for (const [channel, level] of notificationLevels) {
			obj[channel] = level;
		}
		localStorage.setItem(NOTIFICATION_LEVELS_KEY, JSON.stringify(obj));
	} catch {
		// Storage full or unavailable
	}
}

// Load persisted levels on module init
loadNotificationLevels();

/** Get the notification level for a channel. Returns 'mentions' (default) if not set. */
export function getNotificationLevel(channel: string): NotificationLevel {
	return notificationLevels.get(channel) ?? 'mentions';
}

/** Set the notification level for a channel. Setting to 'mentions' removes the override. */
export function setNotificationLevel(channel: string, level: NotificationLevel): void {
	if (level === 'mentions') {
		notificationLevels.delete(channel);
	} else {
		notificationLevels.set(channel, level);
	}
	saveNotificationLevels();
}

/** Returns true if the channel is muted (notification level is 'mute'). */
export function isMuted(channel: string): boolean {
	return getNotificationLevel(channel) === 'mute';
}

/** Reset all notification levels (clears memory and localStorage). */
export function resetNotificationLevels(): void {
	notificationLevels.clear();
	if (hasLocalStorage()) {
		localStorage.removeItem(NOTIFICATION_LEVELS_KEY);
	}
}

/**
 * Reactive notification store.
 * Uses version counter pattern (like messages/members) because
 * Svelte 5 $state doesn't deeply track Map mutations.
 */
const _channels = new Map<string, ChannelNotification>();
let _version = $state(0);

function notify(): void { _version++; }

/** Legacy export for components that read the store directly. */
export const notificationState = {
	get channels() { void _version; return _channels; },
};

function ensureChannel(channel: string): ChannelNotification {
	if (!_channels.has(channel)) {
		_channels.set(channel, {
			unreadCount: 0,
			mentionCount: 0,
			lastReadMsgid: null,
		});
	}
	return _channels.get(channel)!;
}

/**
 * Increment unread count for a channel. Called on new message when channel
 * is not the active channel. If isMention is true, also increments mention count.
 *
 * Respects per-channel notification levels:
 * - 'mute': Suppresses unread increments unless isMention is true.
 * - All other levels: Increments normally (OS notification filtering is separate).
 */
export function incrementUnread(channel: string, isMention: boolean): void {
	const level = getNotificationLevel(channel);

	// Muted channels only track @mentions, not regular unreads
	if (level === 'mute' && !isMention) {
		return;
	}

	const ch = ensureChannel(channel);
	ch.unreadCount++;
	if (isMention) {
		ch.mentionCount++;
	}
	notify();
}

/**
 * Mark a channel as read. Resets unread/mention counts and updates
 * the last read message ID.
 */
export function markRead(channel: string, msgid: string): void {
	const ch = ensureChannel(channel);
	ch.unreadCount = 0;
	ch.mentionCount = 0;
	ch.lastReadMsgid = msgid;
	notify();
}

/** Get the unread message count for a channel. Returns 0 if not tracked. */
export function getUnreadCount(channel: string): number {
	void _version;
	return _channels.get(channel)?.unreadCount ?? 0;
}

/** Get the mention count for a channel. Returns 0 if not tracked. */
export function getMentionCount(channel: string): number {
	void _version;
	return _channels.get(channel)?.mentionCount ?? 0;
}

/** Get the last read message ID for a channel. Returns null if not set. */
export function getLastReadMsgid(channel: string): string | null {
	void _version;
	return _channels.get(channel)?.lastReadMsgid ?? null;
}

/** Set the last read message ID without resetting counts (e.g. from server sync). */
export function setLastReadMsgid(channel: string, msgid: string): void {
	const ch = ensureChannel(channel);
	ch.lastReadMsgid = msgid;
	notify();
}

/**
 * Mark all channels as read — clears unread and mention counts for every
 * tracked channel. Used by the "Mark as Read" server context menu action.
 */
export function markAllRead(): void {
	for (const ch of _channels.values()) {
		ch.unreadCount = 0;
		ch.mentionCount = 0;
	}
	notify();
}

/** Reset all notification state. */
export function resetNotifications(): void {
	_channels.clear();
	notify();
}
