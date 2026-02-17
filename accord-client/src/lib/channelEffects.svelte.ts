/**
 * Reactive channel lifecycle effects extracted from +page.svelte.
 *
 * Call `setupChannelEffects()` during component init (inside a reactive
 * context) to wire up the effects. They read global state stores directly
 * and use getter callbacks for component-local state.
 */

import type { IRCConnection } from '$lib/irc/connection';
import { chathistory, markread } from '$lib/irc/commands';
import { updateMonitorForChannel } from '$lib/channelMonitor';
import { channelUIState, getChannel, isDMTarget } from '$lib/state/channels.svelte';
import { markRead } from '$lib/state/notifications.svelte';
import { getCursors } from '$lib/state/messages.svelte';

export interface ChannelEffectsDeps {
	/** Current IRC connection (may be null during init/reconnect). */
	getConn(): IRCConnection | null;
	/** Called on channel switch to reset UI state. */
	onChannelSwitch(): void;
}

/**
 * Set up reactive channel lifecycle effects.
 * Must be called during component initialisation (so $effect runs in the
 * correct reactive owner context).
 */
export function setupChannelEffects(deps: ChannelEffectsDeps): void {
	// --- Effect: mark read + request history on channel switch ----------------
	let prevActiveChannel: string | null = null;
	$effect(() => {
		const channel = channelUIState.activeChannel;
		if (!channel || channel === prevActiveChannel) return;
		prevActiveChannel = channel;

		const conn = deps.getConn();

		// Mark channel as read locally
		const cursors = getCursors(channel);
		if (cursors.newestMsgid) {
			markRead(channel, cursors.newestMsgid);
		}

		// Sync read position via IRC MARKREAD
		if (conn) {
			if (cursors.newestMsgid) {
				markread(conn, channel, new Date().toISOString());
			} else {
				markread(conn, channel);
				chathistory(conn, 'LATEST', channel, '*', '50');
			}
		}

		// Update MONITOR list for presence tracking
		updateMonitorForChannel(conn, channel);

		// Reset component UI state
		deps.onChannelSwitch();
	});

	// --- Effect: re-run MONITOR after NAMES completes for the active channel --
	let monitoredAfterNames: string | null = null;
	$effect(() => {
		const channel = channelUIState.activeChannel;
		if (!channel || isDMTarget(channel)) return;
		const ch = getChannel(channel);
		if (!ch?.namesLoaded) {
			if (monitoredAfterNames !== channel) monitoredAfterNames = null;
			return;
		}
		if (monitoredAfterNames === channel) return;
		monitoredAfterNames = channel;
		updateMonitorForChannel(deps.getConn(), channel);
	});

	// --- Effect: auto-register #general with ChanServ on fresh server ---------
	let hasAttemptedRegister = false;
	$effect(() => {
		const conn = deps.getConn();
		if (hasAttemptedRegister || !conn) return;
		const ch = getChannel('#general');
		if (!ch || !ch.namesLoaded) return;

		let hasFounder = false;
		for (const member of ch.members.values()) {
			if (member.prefix.includes('~')) { hasFounder = true; break; }
		}
		if (hasFounder) return;

		hasAttemptedRegister = true;
		conn.send('CS REGISTER #general');
	});
}
