/**
 * Desktop notification support via the Notification API.
 *
 * Only fires when the window is not focused (document.hidden === true).
 * Respects the desktopNotificationsEnabled setting from appSettings.
 */

import { appSettings } from '$lib/state/appSettings.svelte';

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

/**
 * Request permission to show desktop notifications.
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
	if (typeof Notification === 'undefined') return 'denied';
	const result = await Notification.requestPermission();
	return result as NotificationPermissionState;
}

/**
 * Get the current notification permission state.
 */
export function getNotificationPermission(): NotificationPermissionState {
	if (typeof Notification === 'undefined') return 'denied';
	return Notification.permission as NotificationPermissionState;
}

export interface DesktopNotificationOptions {
	/** Icon URL for the notification. */
	icon?: string;
	/** Tag to replace existing notifications with the same tag. */
	tag?: string;
	/** Whether the notification should be silent (no system sound). */
	silent?: boolean;
}

/**
 * Show a desktop notification if:
 * - Desktop notifications are enabled in settings
 * - Permission has been granted
 * - The window is not currently focused (document is hidden)
 *
 * Returns the Notification instance if shown, or null if suppressed.
 */
export function showDesktopNotification(
	title: string,
	body: string,
	options?: DesktopNotificationOptions,
): Notification | null {
	if (!appSettings.desktopNotificationsEnabled) return null;
	if (typeof Notification === 'undefined') return null;
	if (Notification.permission !== 'granted') return null;
	if (typeof document !== 'undefined' && !document.hidden) return null;

	const notification = new Notification(title, {
		body,
		icon: options?.icon,
		tag: options?.tag,
		silent: options?.silent ?? true, // silent by default — we have our own sounds
	});

	// Auto-close after 5 seconds
	setTimeout(() => notification.close(), 5000);

	return notification;
}

/**
 * Show a desktop notification for a mention.
 * Includes sender name and a message preview.
 */
export function showMentionNotification(
	channel: string,
	sender: string,
	messagePreview: string,
): Notification | null {
	return showDesktopNotification(
		`${sender} mentioned you in ${channel}`,
		messagePreview,
		{ tag: `mention:${channel}` },
	);
}

/**
 * Show a desktop notification for a direct message.
 */
export function showDMNotification(
	sender: string,
	messagePreview: string,
): Notification | null {
	return showDesktopNotification(
		`${sender}`,
		messagePreview,
		{ tag: `dm:${sender}` },
	);
}
