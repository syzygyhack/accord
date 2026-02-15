/**
 * System message utilities — detection, filtering, and grouping.
 *
 * Extracted from MessageList.svelte so the logic is independently testable.
 */

import type { Message, MessageType } from '$lib/state/messages.svelte';
import type { SystemMessageDisplay } from '$lib/state/appSettings.svelte';

/** The set of message types considered "system" (non-chat). */
export const SYSTEM_TYPES: ReadonlySet<MessageType> = new Set([
	'join', 'part', 'quit', 'nick', 'mode',
]);

/** Check whether a message is a system message (join/part/quit/nick/mode). */
export function isSystemMessage(msg: Message): boolean {
	return SYSTEM_TYPES.has(msg.type);
}

/**
 * Build a human-readable summary for a collapsed system message group.
 * E.g., "5 join/part events" or "3 mode events".
 */
export function summarizeCollapsedGroup(messages: Message[]): string {
	const types = new Set<string>();
	for (const msg of messages) {
		types.add(msg.type);
	}
	const sorted = [...types].sort();
	return `${messages.length} ${sorted.join('/')} events`;
}

/**
 * Determine whether a system message should be shown given the current
 * display mode. Non-system messages always pass through.
 *
 * @param msg             The message to check.
 * @param display         The current systemMessageDisplay setting.
 * @param recentSpeakers  Set of nicks who sent a privmsg in the last 15 min.
 */
export function filterSystemMessage(
	msg: Message,
	display: SystemMessageDisplay,
	recentSpeakers: Set<string>,
): boolean {
	// Non-system messages are never filtered.
	if (!isSystemMessage(msg)) return true;

	switch (display) {
		case 'all':
			return true;
		case 'none':
			return false;
		case 'smart':
			return recentSpeakers.has(msg.nick);
		default:
			return true;
	}
}
