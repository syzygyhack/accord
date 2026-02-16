import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	notificationState,
	incrementUnread,
	markRead,
	markAllRead,
	getUnreadCount,
	getMentionCount,
	getLastReadMsgid,
	setLastReadMsgid,
	resetNotifications,
	getNotificationLevel,
	setNotificationLevel,
	isMuted,
	resetNotificationLevels,
	type NotificationLevel,
} from './notifications.svelte';

/**
 * Minimal localStorage mock — vitest runs in Node where localStorage
 * is not available by default.
 */
function createLocalStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (_index: number) => null,
	} as Storage;
}

describe('notifications state', () => {
	beforeEach(() => {
		resetNotifications();
	});

	describe('incrementUnread', () => {
		it('increments unread count for a channel', () => {
			incrementUnread('#test', false);
			expect(getUnreadCount('#test')).toBe(1);
		});

		it('increments multiple times', () => {
			incrementUnread('#test', false);
			incrementUnread('#test', false);
			incrementUnread('#test', false);
			expect(getUnreadCount('#test')).toBe(3);
		});

		it('does not increment mention count for non-mentions', () => {
			incrementUnread('#test', false);
			expect(getMentionCount('#test')).toBe(0);
		});

		it('increments both unread and mention count for mentions', () => {
			incrementUnread('#test', true);
			expect(getUnreadCount('#test')).toBe(1);
			expect(getMentionCount('#test')).toBe(1);
		});

		it('tracks mention count separately from unread count', () => {
			incrementUnread('#test', false);
			incrementUnread('#test', true);
			incrementUnread('#test', false);
			expect(getUnreadCount('#test')).toBe(3);
			expect(getMentionCount('#test')).toBe(1);
		});

		it('tracks per-channel independently', () => {
			incrementUnread('#a', false);
			incrementUnread('#a', false);
			incrementUnread('#b', true);
			expect(getUnreadCount('#a')).toBe(2);
			expect(getMentionCount('#a')).toBe(0);
			expect(getUnreadCount('#b')).toBe(1);
			expect(getMentionCount('#b')).toBe(1);
		});
	});

	describe('markRead', () => {
		it('resets unread and mention counts', () => {
			incrementUnread('#test', false);
			incrementUnread('#test', true);
			incrementUnread('#test', false);
			markRead('#test', 'msg-42');
			expect(getUnreadCount('#test')).toBe(0);
			expect(getMentionCount('#test')).toBe(0);
		});

		it('sets lastReadMsgid', () => {
			markRead('#test', 'msg-42');
			expect(getLastReadMsgid('#test')).toBe('msg-42');
		});

		it('updates lastReadMsgid on subsequent calls', () => {
			markRead('#test', 'msg-1');
			markRead('#test', 'msg-2');
			expect(getLastReadMsgid('#test')).toBe('msg-2');
		});

		it('does not affect other channels', () => {
			incrementUnread('#a', false);
			incrementUnread('#b', false);
			markRead('#a', 'msg-1');
			expect(getUnreadCount('#a')).toBe(0);
			expect(getUnreadCount('#b')).toBe(1);
		});
	});

	describe('getUnreadCount', () => {
		it('returns 0 for unknown channel', () => {
			expect(getUnreadCount('#unknown')).toBe(0);
		});
	});

	describe('getMentionCount', () => {
		it('returns 0 for unknown channel', () => {
			expect(getMentionCount('#unknown')).toBe(0);
		});
	});

	describe('getLastReadMsgid', () => {
		it('returns null for unknown channel', () => {
			expect(getLastReadMsgid('#unknown')).toBeNull();
		});
	});

	describe('setLastReadMsgid', () => {
		it('sets lastReadMsgid without resetting counts', () => {
			incrementUnread('#test', false);
			incrementUnread('#test', true);
			setLastReadMsgid('#test', 'msg-99');
			// Counts should remain untouched
			expect(getUnreadCount('#test')).toBe(2);
			expect(getMentionCount('#test')).toBe(1);
			expect(getLastReadMsgid('#test')).toBe('msg-99');
		});

		it('updates an existing lastReadMsgid', () => {
			setLastReadMsgid('#test', 'msg-1');
			setLastReadMsgid('#test', 'msg-2');
			expect(getLastReadMsgid('#test')).toBe('msg-2');
		});
	});

	describe('markAllRead', () => {
		it('clears unread and mention counts for all channels', () => {
			incrementUnread('#a', false);
			incrementUnread('#a', true);
			incrementUnread('#b', false);
			incrementUnread('#b', false);
			markAllRead();
			expect(getUnreadCount('#a')).toBe(0);
			expect(getMentionCount('#a')).toBe(0);
			expect(getUnreadCount('#b')).toBe(0);
		});

		it('preserves lastReadMsgid', () => {
			markRead('#a', 'msg-5');
			incrementUnread('#a', false);
			markAllRead();
			expect(getUnreadCount('#a')).toBe(0);
			expect(getLastReadMsgid('#a')).toBe('msg-5');
		});

		it('is a no-op when no channels are tracked', () => {
			// Should not throw
			markAllRead();
			expect(getUnreadCount('#nonexistent')).toBe(0);
		});
	});

	describe('resetNotifications', () => {
		it('clears all notification state', () => {
			incrementUnread('#a', true);
			incrementUnread('#b', false);
			markRead('#a', 'msg-1');
			resetNotifications();
			expect(getUnreadCount('#a')).toBe(0);
			expect(getMentionCount('#a')).toBe(0);
			expect(getLastReadMsgid('#a')).toBeNull();
			expect(getUnreadCount('#b')).toBe(0);
		});

		it('has empty channels map after reset', () => {
			incrementUnread('#test', false);
			resetNotifications();
			expect(notificationState.channels.size).toBe(0);
		});
	});

	describe('per-channel notification levels', () => {
		let storage: Storage;

		beforeEach(() => {
			storage = createLocalStorageMock();
			vi.stubGlobal('localStorage', storage);
			resetNotificationLevels();
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		describe('getNotificationLevel', () => {
			it('returns "mentions" as default for unknown channel', () => {
				expect(getNotificationLevel('#unknown')).toBe('mentions');
			});

			it('returns the set level for a channel', () => {
				setNotificationLevel('#test', 'all');
				expect(getNotificationLevel('#test')).toBe('all');
			});
		});

		describe('setNotificationLevel', () => {
			it('sets notification level for a channel', () => {
				setNotificationLevel('#test', 'nothing');
				expect(getNotificationLevel('#test')).toBe('nothing');
			});

			it('overwrites previous level', () => {
				setNotificationLevel('#test', 'all');
				setNotificationLevel('#test', 'mute');
				expect(getNotificationLevel('#test')).toBe('mute');
			});

			it('persists to localStorage', () => {
				setNotificationLevel('#test', 'all');
				setNotificationLevel('#dev', 'mute');
				const stored = localStorage.getItem('virc:notificationLevels');
				expect(stored).not.toBeNull();
				const parsed = JSON.parse(stored!);
				expect(parsed['#test']).toBe('all');
				expect(parsed['#dev']).toBe('mute');
			});

			it('removes entry and cleans up localStorage when set back to default (mentions)', () => {
				setNotificationLevel('#test', 'all');
				setNotificationLevel('#test', 'mentions');
				expect(getNotificationLevel('#test')).toBe('mentions');
				const stored = localStorage.getItem('virc:notificationLevels');
				if (stored) {
					const parsed = JSON.parse(stored);
					expect(parsed['#test']).toBeUndefined();
				}
			});
		});

		describe('isMuted', () => {
			it('returns false for unknown channel', () => {
				expect(isMuted('#unknown')).toBe(false);
			});

			it('returns false for channels set to "all"', () => {
				setNotificationLevel('#test', 'all');
				expect(isMuted('#test')).toBe(false);
			});

			it('returns false for channels set to "mentions"', () => {
				setNotificationLevel('#test', 'mentions');
				expect(isMuted('#test')).toBe(false);
			});

			it('returns false for channels set to "nothing"', () => {
				setNotificationLevel('#test', 'nothing');
				expect(isMuted('#test')).toBe(false);
			});

			it('returns true for channels set to "mute"', () => {
				setNotificationLevel('#test', 'mute');
				expect(isMuted('#test')).toBe(true);
			});
		});

		describe('incrementUnread respects notification levels', () => {
			it('increments normally for "all" level', () => {
				setNotificationLevel('#test', 'all');
				incrementUnread('#test', false);
				expect(getUnreadCount('#test')).toBe(1);
			});

			it('increments normally for "mentions" level (default)', () => {
				incrementUnread('#test', false);
				expect(getUnreadCount('#test')).toBe(1);
			});

			it('increments normally for "nothing" level (still tracks unreads, just no OS notifications)', () => {
				setNotificationLevel('#test', 'nothing');
				incrementUnread('#test', false);
				expect(getUnreadCount('#test')).toBe(1);
			});

			it('suppresses unread increment for muted channels (non-mention)', () => {
				setNotificationLevel('#test', 'mute');
				incrementUnread('#test', false);
				expect(getUnreadCount('#test')).toBe(0);
			});

			it('allows mention increment for muted channels', () => {
				setNotificationLevel('#test', 'mute');
				incrementUnread('#test', true);
				expect(getUnreadCount('#test')).toBe(1);
				expect(getMentionCount('#test')).toBe(1);
			});

			it('suppresses unread-only for muted channels but counts mentions', () => {
				setNotificationLevel('#test', 'mute');
				incrementUnread('#test', false);
				incrementUnread('#test', true);
				incrementUnread('#test', false);
				expect(getUnreadCount('#test')).toBe(1);
				expect(getMentionCount('#test')).toBe(1);
			});
		});

		describe('resetNotificationLevels', () => {
			it('clears all notification levels', () => {
				setNotificationLevel('#a', 'all');
				setNotificationLevel('#b', 'mute');
				resetNotificationLevels();
				expect(getNotificationLevel('#a')).toBe('mentions');
				expect(getNotificationLevel('#b')).toBe('mentions');
			});

			it('clears localStorage', () => {
				setNotificationLevel('#test', 'all');
				resetNotificationLevels();
				const stored = localStorage.getItem('virc:notificationLevels');
				expect(stored).toBeNull();
			});
		});

		describe('localStorage persistence roundtrip', () => {
			it('persists and retrieves notification levels', () => {
				// Set levels which persist to localStorage
				setNotificationLevel('#test', 'mute');
				setNotificationLevel('#dev', 'all');

				// Verify localStorage has the data
				const stored = localStorage.getItem('virc:notificationLevels');
				expect(stored).not.toBeNull();
				const parsed = JSON.parse(stored!);
				expect(parsed['#test']).toBe('mute');
				expect(parsed['#dev']).toBe('all');

				// In-memory levels should reflect what was set
				expect(getNotificationLevel('#test')).toBe('mute');
				expect(getNotificationLevel('#dev')).toBe('all');
			});

			it('reset clears both memory and localStorage', () => {
				setNotificationLevel('#test', 'mute');
				resetNotificationLevels();
				expect(getNotificationLevel('#test')).toBe('mentions');
				expect(localStorage.getItem('virc:notificationLevels')).toBeNull();
			});
		});
	});
});
