/**
 * Message action handlers extracted from +page.svelte.
 *
 * Each handler receives a context object with getters/setters for component
 * state and the IRC connection, so this module never touches Svelte reactive
 * state directly.
 */

import type { IRCConnection } from '$lib/irc/connection';
import { tagmsg, redact, privmsg, markread, escapeTagValue } from '$lib/irc/commands';
import { channelUIState } from '$lib/state/channels.svelte';
import { userState } from '$lib/state/user.svelte';
import {
	getMessage,
	getMessages,
	redactMessage,
	updateSendState,
	pinMessage,
	unpinMessage,
	isPinned,
} from '$lib/state/messages.svelte';
import { getActiveServer } from '$lib/state/servers.svelte';
import { markRead } from '$lib/state/notifications.svelte';
import { getCursors } from '$lib/state/messages.svelte';

// ---- Types ----------------------------------------------------------------

export interface ReplyContext {
	msgid: string;
	nick: string;
	text: string;
}

/** Mutable state that the component owns; the module reads/writes via these. */
export interface MessageActionState {
	getConn(): IRCConnection | null;
	getReplyContext(): ReplyContext | null;
	setReplyContext(ctx: ReplyContext | null): void;
	getEmojiPickerTarget(): string | null;
	setEmojiPickerTarget(target: string | null): void;
	getEmojiPickerPosition(): { x: number; y: number } | null;
	setEmojiPickerPosition(pos: { x: number; y: number } | null): void;
	getDeleteTarget(): { msgid: string; channel: string } | null;
	setDeleteTarget(target: { msgid: string; channel: string } | null): void;
	getEditingMsgid(): string | null;
	setEditingMsgid(msgid: string | null): void;
	getEditingChannel(): string | null;
	setEditingChannel(channel: string | null): void;
}

// ---- Handlers -------------------------------------------------------------

/** Reply button clicked on a message. */
export function handleReply(state: MessageActionState, msgid: string): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	const msg = getMessage(channel, msgid);
	if (!msg) return;
	state.setReplyContext({
		msgid: msg.msgid,
		nick: msg.nick,
		text: msg.text,
	});
}

export function handleCancelReply(state: MessageActionState): void {
	state.setReplyContext(null);
}

/**
 * React button clicked on a message — open emoji picker.
 * If anchor coordinates are provided (from the reaction bar '+' button),
 * position the picker near the anchor. Otherwise center it on screen.
 */
export function handleReact(state: MessageActionState, msgid: string, anchor?: { x: number; y: number }): void {
	state.setEmojiPickerTarget(msgid);
	if (anchor) {
		const pickerWidth = 352;
		const pickerHeight = 400;
		state.setEmojiPickerPosition({
			x: Math.max(16, Math.min(anchor.x, window.innerWidth - pickerWidth - 16)),
			y: Math.max(16, anchor.y - pickerHeight - 8),
		});
	} else {
		state.setEmojiPickerPosition({
			x: Math.max(16, window.innerWidth / 2 - 176),
			y: Math.max(16, window.innerHeight / 2 - 200),
		});
	}
}

/** Open emoji picker for inserting into the message input. */
export function handleInputEmojiPicker(state: MessageActionState): void {
	state.setEmojiPickerTarget('__emoji_input__');
	state.setEmojiPickerPosition({
		x: Math.max(16, window.innerWidth / 2 - 176),
		y: Math.max(16, window.innerHeight / 2 - 200),
	});
}

/** Emoji selected from picker — either insert into input or send reaction TAGMSG. */
export function handleEmojiSelect(state: MessageActionState, emoji: string): void {
	const target = state.getEmojiPickerTarget();
	if (target === '__emoji_input__') {
		window.dispatchEvent(new CustomEvent('accord:insert-emoji', { detail: { emoji } }));
		state.setEmojiPickerTarget(null);
		state.setEmojiPickerPosition(null);
		return;
	}
	const conn = state.getConn();
	if (!conn || !target || !channelUIState.activeChannel) return;
	tagmsg(conn, channelUIState.activeChannel, {
		'+draft/react': emoji,
		'+draft/reply': target,
	});
	state.setEmojiPickerTarget(null);
	state.setEmojiPickerPosition(null);
}

export function handleEmojiPickerClose(state: MessageActionState): void {
	state.setEmojiPickerTarget(null);
	state.setEmojiPickerPosition(null);
}

/** Toggle a reaction on a message (click existing reaction pill). */
export function handleToggleReaction(state: MessageActionState, msgid: string, emoji: string): void {
	const conn = state.getConn();
	if (!conn || !channelUIState.activeChannel) return;
	tagmsg(conn, channelUIState.activeChannel, {
		'+draft/react': emoji,
		'+draft/reply': msgid,
	});
}

/** More menu clicked — offer delete. */
export function handleMore(state: MessageActionState, msgid: string, _event: MouseEvent): void {
	if (!channelUIState.activeChannel) return;
	state.setDeleteTarget({ msgid, channel: channelUIState.activeChannel });
}

/** Pin/unpin a message in the active channel. */
export function handlePin(msgid: string): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	if (isPinned(channel, msgid)) {
		unpinMessage(channel, msgid);
	} else {
		pinMessage(channel, msgid);
	}
}

/** Confirm message deletion — send REDACT. */
export function handleConfirmDelete(state: MessageActionState): void {
	const conn = state.getConn();
	const deleteTarget = state.getDeleteTarget();
	if (!conn || !deleteTarget) return;
	redact(conn, deleteTarget.channel, deleteTarget.msgid);
	redactMessage(deleteTarget.channel, deleteTarget.msgid);
	state.setDeleteTarget(null);
}

export function handleCancelDelete(state: MessageActionState): void {
	state.setDeleteTarget(null);
}

/** Retry sending a failed message. */
export function handleRetry(state: MessageActionState, msgid: string): void {
	const channel = channelUIState.activeChannel;
	const conn = state.getConn();
	if (!channel || !conn) return;
	const msg = getMessage(channel, msgid);
	if (!msg || msg.sendState !== 'failed') return;

	updateSendState(channel, msgid, 'sending');
	let sent: boolean;
	if (msg.replyTo) {
		const tags = `@+draft/reply=${escapeTagValue(msg.replyTo)}`;
		sent = conn.send(`${tags} PRIVMSG ${channel} :${msg.text}`);
	} else {
		sent = privmsg(conn, channel, msg.text);
	}
	updateSendState(channel, msgid, sent ? 'sent' : 'failed');
}

/**
 * "Edit" the last message by the current user:
 * Populates the input with the message text. The original message is only
 * redacted when the user actually sends the edited text.
 */
export function editLastMessage(state: MessageActionState): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	const nick = userState.nick;
	if (!nick) return;

	const msgs = getMessages(channel);
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		if (m.nick === nick && m.type === 'privmsg' && !m.isRedacted) {
			state.setEditingMsgid(m.msgid);
			state.setEditingChannel(channel);
			window.dispatchEvent(
				new CustomEvent('accord:edit-message', { detail: { text: m.text } })
			);
			return;
		}
	}
}

/** Called by MessageInput after a successful send while editing. */
export function handleEditComplete(state: MessageActionState): void {
	state.setEditingMsgid(null);
	state.setEditingChannel(null);
}

/** Called when the user cancels editing (Escape or clearing input). */
export function handleEditCancel(state: MessageActionState): void {
	state.setEditingMsgid(null);
	state.setEditingChannel(null);
}

/** Edit a specific message by msgid (from More menu). */
export function handleEditMessage(state: MessageActionState, msgid: string): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	const msg = getMessage(channel, msgid);
	if (!msg || msg.isRedacted) return;

	state.setEditingMsgid(msg.msgid);
	state.setEditingChannel(channel);
	window.dispatchEvent(
		new CustomEvent('accord:edit-message', { detail: { text: msg.text } })
	);
}

/** Copy message text to clipboard. */
export function handleCopyText(text: string): void {
	navigator.clipboard.writeText(text).catch(() => {});
}

/** Copy a permalink-style reference to clipboard. */
export function handleCopyLink(msgid: string): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	const server = getActiveServer();
	const serverName = server?.name ?? 'irc';
	const link = `${serverName}/${channel}/${msgid}`;
	navigator.clipboard.writeText(link).catch(() => {});
}

/** Set read marker to a specific message (Mark Unread). */
export function handleMarkUnread(state: MessageActionState, msgid: string): void {
	const channel = channelUIState.activeChannel;
	const conn = state.getConn();
	if (!channel || !conn) return;
	const msg = getMessage(channel, msgid);
	if (!msg) return;
	markread(conn, channel, msg.time.toISOString());
}

/** Scroll to a specific message in the message list (used by pinned messages). */
export function handleScrollToMessage(msgid: string): void {
	window.dispatchEvent(
		new CustomEvent('accord:scroll-to-message', { detail: { msgid } })
	);
}

/** Mark the active channel as read and sync via MARKREAD. */
export function markActiveChannelRead(conn: IRCConnection | null): void {
	const channel = channelUIState.activeChannel;
	if (!channel) return;
	const cursors = getCursors(channel);
	if (cursors.newestMsgid) {
		markRead(channel, cursors.newestMsgid);
	}
	if (conn) {
		markread(conn, channel, new Date().toISOString());
	}
}

// ---- Bound action factory --------------------------------------------------

/** All message action handlers, pre-bound to component state. */
export interface BoundMessageActions {
	handleReply: (msgid: string) => void;
	handleCancelReply: () => void;
	handleReact: (msgid: string, anchor?: { x: number; y: number }) => void;
	handleInputEmojiPicker: () => void;
	handleEmojiSelect: (emoji: string) => void;
	handleEmojiPickerClose: () => void;
	handleToggleReaction: (msgid: string, emoji: string) => void;
	handleMore: (msgid: string, event: MouseEvent) => void;
	handlePin: (msgid: string) => void;
	handleConfirmDelete: () => void;
	handleCancelDelete: () => void;
	handleRetry: (msgid: string) => void;
	editLastMessage: () => void;
	handleEditComplete: () => void;
	handleEditCancel: () => void;
	handleEditMessage: (msgid: string) => void;
	handleCopyText: (text: string) => void;
	handleCopyLink: (msgid: string) => void;
	handleMarkUnread: (msgid: string) => void;
	handleScrollToMessage: (msgid: string) => void;
	markActiveChannelRead: () => void;
}

/**
 * Create all message action handlers pre-bound to the given component state.
 * Eliminates per-handler wrapper boilerplate in +page.svelte.
 */
export function createBoundActions(state: MessageActionState): BoundMessageActions {
	return {
		handleReply: (msgid) => handleReply(state, msgid),
		handleCancelReply: () => handleCancelReply(state),
		handleReact: (msgid, anchor?) => handleReact(state, msgid, anchor),
		handleInputEmojiPicker: () => handleInputEmojiPicker(state),
		handleEmojiSelect: (emoji) => handleEmojiSelect(state, emoji),
		handleEmojiPickerClose: () => handleEmojiPickerClose(state),
		handleToggleReaction: (msgid, emoji) => handleToggleReaction(state, msgid, emoji),
		handleMore: (msgid, event) => handleMore(state, msgid, event),
		handlePin,
		handleConfirmDelete: () => handleConfirmDelete(state),
		handleCancelDelete: () => handleCancelDelete(state),
		handleRetry: (msgid) => handleRetry(state, msgid),
		editLastMessage: () => editLastMessage(state),
		handleEditComplete: () => handleEditComplete(state),
		handleEditCancel: () => handleEditCancel(state),
		handleEditMessage: (msgid) => handleEditMessage(state, msgid),
		handleCopyText,
		handleCopyLink,
		handleMarkUnread: (msgid) => handleMarkUnread(state, msgid),
		handleScrollToMessage,
		markActiveChannelRead: () => markActiveChannelRead(state.getConn()),
	};
}
