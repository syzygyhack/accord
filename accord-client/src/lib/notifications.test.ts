import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	requestNotificationPermission,
	getNotificationPermission,
	showDesktopNotification,
	showMentionNotification,
	showDMNotification,
} from './notifications';
import { appSettings, resetAppSettings } from '$lib/state/appSettings.svelte';

function createStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() { return store.size; },
		key: (_index: number) => null,
	} as Storage;
}

/** Mock Notification constructor that supports `new`. */
function createNotificationMock(permission: NotificationPermission = 'granted') {
	const instances: { title: string; options: any; close: any }[] = [];

	// Use a class so `new MockNotification(...)` works
	class MockNotification {
		title: string;
		options: any;
		close = vi.fn();
		constructor(title: string, options?: NotificationOptions) {
			this.title = title;
			this.options = options;
			instances.push(this);
		}
		static permission = permission;
		static requestPermission = vi.fn().mockResolvedValue(permission);
		static _instances = instances;
	}

	return MockNotification;
}

describe('notifications (desktop)', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		// Provide a minimal document mock for tests that need document.hidden
		vi.stubGlobal('document', { hidden: true });
		resetAppSettings();
		appSettings.desktopNotificationsEnabled = true;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	describe('getNotificationPermission', () => {
		it('returns "denied" when Notification is undefined', () => {
			vi.stubGlobal('Notification', undefined);
			expect(getNotificationPermission()).toBe('denied');
		});

		it('returns current permission state', () => {
			vi.stubGlobal('Notification', createNotificationMock('granted'));
			expect(getNotificationPermission()).toBe('granted');
		});

		it('returns "default" for default permission', () => {
			vi.stubGlobal('Notification', createNotificationMock('default'));
			expect(getNotificationPermission()).toBe('default');
		});
	});

	describe('requestNotificationPermission', () => {
		it('returns "denied" when Notification is undefined', async () => {
			vi.stubGlobal('Notification', undefined);
			expect(await requestNotificationPermission()).toBe('denied');
		});

		it('calls Notification.requestPermission and returns result', async () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			const result = await requestNotificationPermission();
			expect(mock.requestPermission).toHaveBeenCalled();
			expect(result).toBe('granted');
		});
	});

	describe('showDesktopNotification', () => {
		it('returns null when desktop notifications are disabled', () => {
			appSettings.desktopNotificationsEnabled = false;
			vi.stubGlobal('Notification', createNotificationMock('granted'));
			vi.stubGlobal('document', { hidden: true });
			expect(showDesktopNotification('Test', 'body')).toBeNull();
		});

		it('returns null when Notification is undefined', () => {
			vi.stubGlobal('Notification', undefined);
			expect(showDesktopNotification('Test', 'body')).toBeNull();
		});

		it('returns null when permission is not granted', () => {
			vi.stubGlobal('Notification', createNotificationMock('denied'));
			vi.stubGlobal('document', { hidden: true });
			expect(showDesktopNotification('Test', 'body')).toBeNull();
		});

		it('returns null when document is visible (window focused)', () => {
			vi.stubGlobal('Notification', createNotificationMock('granted'));
			vi.stubGlobal('document', { hidden: false });
			expect(showDesktopNotification('Test', 'body')).toBeNull();
		});

		it('creates notification when all conditions are met', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			const result = showDesktopNotification('Title', 'Body text');
			expect(result).not.toBeNull();
			expect(mock._instances).toHaveLength(1);
			expect(mock._instances[0].title).toBe('Title');
			expect(mock._instances[0].options).toMatchObject({
				body: 'Body text',
				silent: true,
			});
		});

		it('passes icon and tag options', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			showDesktopNotification('Test', 'body', { icon: '/icon.png', tag: 'test-tag' });
			expect(mock._instances).toHaveLength(1);
			expect(mock._instances[0].options).toMatchObject({
				icon: '/icon.png',
				tag: 'test-tag',
			});
		});

		it('auto-closes notification after 5 seconds', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			showDesktopNotification('Title', 'Body');
			const instance = mock._instances[0];
			expect(instance.close).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);
			expect(instance.close).toHaveBeenCalled();
		});

		it('respects silent option override', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			showDesktopNotification('Test', 'body', { silent: false });
			expect(mock._instances).toHaveLength(1);
			expect(mock._instances[0].options).toMatchObject({
				silent: false,
			});
		});
	});

	describe('showMentionNotification', () => {
		it('creates notification with channel and sender in title', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			showMentionNotification('#general', 'alice', 'hey @bob check this');
			expect(mock._instances).toHaveLength(1);
			expect(mock._instances[0].title).toBe('alice mentioned you in #general');
			expect(mock._instances[0].options).toMatchObject({
				body: 'hey @bob check this',
				tag: 'mention:#general',
			});
		});
	});

	describe('showDMNotification', () => {
		it('creates notification with sender as title', () => {
			const mock = createNotificationMock('granted');
			vi.stubGlobal('Notification', mock);
			vi.stubGlobal('document', { hidden: true });

			showDMNotification('alice', 'hello there!');
			expect(mock._instances).toHaveLength(1);
			expect(mock._instances[0].title).toBe('alice');
			expect(mock._instances[0].options).toMatchObject({
				body: 'hello there!',
				tag: 'dm:alice',
			});
		});
	});
});
