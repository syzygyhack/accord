/**
 * Central IRC message dispatcher.
 *
 * Takes parsed IRC messages and routes them to the appropriate state
 * update functions. Register this on an IRCConnection's 'message' event.
 */

import type { IRCConnection } from './connection';
import { parseMessage, type ParsedMessage } from './parser';
import {
	addMessage,
	redactMessage,
	addReaction,
	removeReaction,
	prependMessages,
	type Message,
	type MessageType,
} from '../state/messages.svelte';
import {
	addMember,
	removeMember,
	removeMemberFromAll,
	renameMember,
	getChannelsForNick,
	setTopic,
	setNamesLoaded,
} from '../state/channels.svelte';
import { setOnline, setOffline } from '../state/presence.svelte';
import { getActiveChannel } from '../state/channels.svelte';
import { incrementUnread, setLastReadMsgid } from '../state/notifications.svelte';
import { userState } from '../state/user.svelte';
import {
	memberState as richMemberState,
	addMember as addRichMember,
	removeMember as removeRichMember,
	removeMemberFromAll as removeRichMemberFromAll,
	renameMember as renameRichMember,
	updatePresence,
	setPresenceOffline,
	getMember as getRichMember,
} from '../state/members.svelte';

/**
 * Active batches keyed by batch reference tag.
 * Used to accumulate messages within BATCH (e.g. CHATHISTORY results).
 */
interface BatchState {
	type: string;
	target: string;
	messages: Message[];
}

const activeBatches = new Map<string, BatchState>();

/** Typing state: target -> Map<nick, timeout handle>. */
const typingTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

/** Typing state readable by UI: target -> Set<nick>. */
export const typingState = new Map<string, Set<string>>();

const TYPING_TIMEOUT_MS = 6_000;

function setTyping(target: string, nick: string): void {
	if (!typingState.has(target)) {
		typingState.set(target, new Set());
	}
	typingState.get(target)!.add(nick);

	// Clear after timeout
	if (!typingTimers.has(target)) {
		typingTimers.set(target, new Map());
	}
	const timers = typingTimers.get(target)!;

	// Reset existing timer for this nick
	const existing = timers.get(nick);
	if (existing) clearTimeout(existing);

	timers.set(
		nick,
		setTimeout(() => {
			clearTyping(target, nick);
		}, TYPING_TIMEOUT_MS)
	);
}

function clearTyping(target: string, nick: string): void {
	const nicks = typingState.get(target);
	if (nicks) {
		nicks.delete(nick);
		if (nicks.size === 0) typingState.delete(target);
	}

	const timers = typingTimers.get(target);
	if (timers) {
		const t = timers.get(nick);
		if (t) clearTimeout(t);
		timers.delete(nick);
		if (timers.size === 0) typingTimers.delete(target);
	}
}

/**
 * Build a Message object from a parsed PRIVMSG.
 */
function privmsgToMessage(parsed: ParsedMessage, target: string): Message {
	const nick = parsed.source?.nick ?? '';
	const account = parsed.tags['account'] ?? '';
	const msgid = parsed.tags['msgid'] ?? '';
	const time = parsed.tags['time'] ? new Date(parsed.tags['time']) : new Date();
	const text = parsed.params[parsed.params.length - 1] ?? '';
	const replyTo = parsed.tags['+draft/reply'] ?? undefined;

	return {
		msgid,
		nick,
		account,
		target,
		text,
		time,
		tags: parsed.tags,
		replyTo,
		reactions: new Map(),
		isRedacted: false,
		type: 'privmsg',
	};
}

/** Counter for generating unique msgids for system messages. */
let systemMsgCounter = 0;

/**
 * Build a system Message (JOIN/PART/QUIT).
 */
function systemMessage(type: MessageType, target: string, nick: string, text: string, parsed: ParsedMessage): Message {
	const time = parsed.tags['time'] ? new Date(parsed.tags['time']) : new Date();
	return {
		msgid: parsed.tags['msgid'] ?? `_sys_${type}_${++systemMsgCounter}`,
		nick,
		account: parsed.tags['account'] ?? '',
		target,
		text,
		time,
		tags: parsed.tags,
		reactions: new Map(),
		isRedacted: false,
		type,
	};
}

/**
 * Parse NAMES reply prefixes. Strips mode prefix chars (@, +, %, ~, &)
 * and returns the nick, its prefix string, and individual mode chars.
 */
function parseNamesEntry(entry: string): { nick: string; prefix: string; modes: string[] } {
	let prefix = '';
	const modes: string[] = [];
	let i = 0;
	const prefixChars = '@+%~&';

	while (i < entry.length && prefixChars.includes(entry[i])) {
		prefix += entry[i];
		modes.push(entry[i]);
		i++;
	}

	// userhost-in-names: nick!user@host — extract just the nick
	const rest = entry.slice(i);
	const bangIdx = rest.indexOf('!');
	const nick = bangIdx !== -1 ? rest.slice(0, bangIdx) : rest;

	return { nick, prefix, modes };
}

/** Mode prefix precedence for computing highest mode. */
const MODE_PRECEDENCE = ['~', '&', '@', '%', '+'];

/** Compute the highest mode from an array of mode prefixes. */
function computeHighestMode(modes: string[]): string | null {
	for (const mode of MODE_PRECEDENCE) {
		if (modes.includes(mode)) return mode;
	}
	return null;
}

/**
 * Parse comma-separated nick list from MONITOR responses.
 * Entries may be nick!user@host format.
 */
function parseMonitorNicks(param: string): string[] {
	return param.split(',').map((entry) => {
		const bangIdx = entry.indexOf('!');
		return bangIdx !== -1 ? entry.slice(0, bangIdx) : entry;
	});
}

/**
 * Handle a single parsed IRC message, dispatching to state updates.
 */
export function handleMessage(parsed: ParsedMessage): void {
	// If this message belongs to a batch, route it there
	const batchRef = parsed.tags['batch'];
	if (batchRef && activeBatches.has(batchRef)) {
		handleBatchedMessage(batchRef, parsed);
		return;
	}

	switch (parsed.command) {
		case 'PRIVMSG':
			handlePrivmsg(parsed);
			break;
		case 'TAGMSG':
			handleTagmsg(parsed);
			break;
		case 'REDACT':
			handleRedact(parsed);
			break;
		case 'JOIN':
			handleJoin(parsed);
			break;
		case 'PART':
			handlePart(parsed);
			break;
		case 'QUIT':
			handleQuit(parsed);
			break;
		case 'NICK':
			handleNick(parsed);
			break;
		case 'MODE':
			handleMode(parsed);
			break;
		case 'TOPIC':
			handleTopic(parsed);
			break;
		case 'BATCH':
			handleBatch(parsed);
			break;
		case '353': // RPL_NAMREPLY
			handleNamesReply(parsed);
			break;
		case '366': // RPL_ENDOFNAMES
			handleEndOfNames(parsed);
			break;
		case 'MARKREAD':
			handleMarkread(parsed);
			break;
		case '332': // RPL_TOPIC
			handleRplTopic(parsed);
			break;
		case '352': // RPL_WHOREPLY
			handleWhoReply(parsed);
			break;
		case '354': // RPL_WHOSPCRPL (WHOX)
			handleWhoxReply(parsed);
			break;
		case 'AWAY':
			handleAway(parsed);
			break;
		case '730': // RPL_MONONLINE
			handleMonitorOnline(parsed);
			break;
		case '731': // RPL_MONOFFLINE
			handleMonitorOffline(parsed);
			break;
		default:
			break;
	}
}

function handlePrivmsg(parsed: ParsedMessage): void {
	const target = parsed.params[0];
	const msg = privmsgToMessage(parsed, target);

	// Clear typing indicator for this user
	if (msg.nick) {
		clearTyping(target, msg.nick);
	}

	addMessage(target, msg);

	// Track unread if this message is for a non-active channel
	const activeChannel = getActiveChannel();
	if (target !== activeChannel) {
		const myAccount = userState.account ?? '';
		const isMention = myAccount !== '' && msg.text.includes(`@${myAccount}`);
		incrementUnread(target, isMention);
	}
}

function handleTagmsg(parsed: ParsedMessage): void {
	const target = parsed.params[0];
	const nick = parsed.source?.nick ?? '';

	// Handle reactions: +draft/react tag
	const reactEmoji = parsed.tags['+draft/react'];
	if (reactEmoji) {
		const replyMsgid = parsed.tags['+draft/reply'];
		if (replyMsgid) {
			const account = parsed.tags['account'] ?? '';
			addReaction(target, replyMsgid, reactEmoji, account);
		}
		return;
	}

	// Handle typing indicators: +typing tag
	const typingValue = parsed.tags['+typing'];
	if (typingValue !== undefined) {
		if (typingValue === 'active') {
			setTyping(target, nick);
		} else {
			// 'paused' or 'done'
			clearTyping(target, nick);
		}
	}
}

function handleRedact(parsed: ParsedMessage): void {
	const target = parsed.params[0];
	const msgid = parsed.params[1];
	if (target && msgid) {
		redactMessage(target, msgid);
	}
}

function handleJoin(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	const nick = parsed.source?.nick ?? '';
	// extended-join provides account and realname as additional params
	const account = parsed.params[1] ?? parsed.tags['account'] ?? '';
	addMember(channel, nick, account);

	// Also add to rich member state
	addRichMember(channel, {
		nick,
		account,
		modes: [],
		highestMode: null,
		isAway: false,
		awayReason: null,
		presence: 'online',
	});

	// Add system message to channel buffer
	const msg = systemMessage('join', channel, nick, `${nick} has joined ${channel}`, parsed);
	addMessage(channel, msg);
}

function handlePart(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	const nick = parsed.source?.nick ?? '';
	removeMember(channel, nick);
	removeRichMember(channel, nick);

	// Add system message to channel buffer
	const reason = parsed.params[1] ? ` (${parsed.params[1]})` : '';
	const msg = systemMessage('part', channel, nick, `${nick} has left ${channel}${reason}`, parsed);
	addMessage(channel, msg);
}

function handleQuit(parsed: ParsedMessage): void {
	const nick = parsed.source?.nick ?? '';
	const reason = parsed.params[0] ? ` (${parsed.params[0]})` : '';

	// Find channels this nick was in before removing
	const channelsWithNick = getChannelsForNick(nick);

	removeMemberFromAll(nick);
	removeRichMemberFromAll(nick);

	// Add system message to each channel the user was in
	for (const channel of channelsWithNick) {
		const msg = systemMessage('quit', channel, nick, `${nick} has quit${reason}`, parsed);
		addMessage(channel, msg);
	}
}

function handleNick(parsed: ParsedMessage): void {
	const oldNick = parsed.source?.nick ?? '';
	const newNick = parsed.params[0] ?? '';
	if (!oldNick || !newNick) return;

	// Find channels before renaming
	const channels = getChannelsForNick(oldNick);

	// Update member state
	renameMember(oldNick, newNick);
	renameRichMember(oldNick, newNick);

	// Add system message to each channel the user is in
	for (const channel of channels) {
		const msg = systemMessage('nick', channel, newNick, `${oldNick} is now known as ${newNick}`, parsed);
		addMessage(channel, msg);
	}

	// Update own nick if it's us
	if (userState.nick === oldNick) {
		userState.nick = newNick;
	}
}

function handleMode(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	if (!channel || !channel.startsWith('#')) return; // Only handle channel modes

	const modeStr = parsed.params[1] ?? '';
	const nick = parsed.source?.nick ?? 'server';
	const text = `${nick} sets mode ${parsed.params.slice(1).join(' ')}`;
	const msg = systemMessage('mode', channel, nick, text, parsed);
	addMessage(channel, msg);
}

function handleTopic(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	const topic = parsed.params[1] ?? '';
	setTopic(channel, topic);
}

/**
 * Handle RPL_TOPIC (332) — topic sent on channel join.
 * :server 332 mynick #channel :The channel topic text
 */
function handleRplTopic(parsed: ParsedMessage): void {
	const channel = parsed.params[1];
	const topic = parsed.params[2] ?? '';
	if (channel) {
		setTopic(channel, topic);
	}
}

function handleBatch(parsed: ParsedMessage): void {
	const refTag = parsed.params[0];
	if (!refTag) return;

	if (refTag.startsWith('+')) {
		// Opening a batch
		const ref = refTag.slice(1);
		const type = parsed.params[1] ?? '';
		const target = parsed.params[2] ?? '';
		activeBatches.set(ref, { type, target, messages: [] });
	} else if (refTag.startsWith('-')) {
		// Closing a batch
		const ref = refTag.slice(1);
		const batch = activeBatches.get(ref);
		if (batch) {
			activeBatches.delete(ref);
			finalizeBatch(batch);
		}
	}
}

function handleBatchedMessage(batchRef: string, parsed: ParsedMessage): void {
	const batch = activeBatches.get(batchRef);
	if (!batch) return;

	if (parsed.command === 'PRIVMSG') {
		const target = parsed.params[0];
		const msg = privmsgToMessage(parsed, target);
		batch.messages.push(msg);
	}
}

function finalizeBatch(batch: BatchState): void {
	if (batch.type === 'chathistory' && batch.target && batch.messages.length > 0) {
		// CHATHISTORY results are prepended (they're historical)
		prependMessages(batch.target, batch.messages);
	}
}

/**
 * Handle MARKREAD response from the server.
 * Format: `MARKREAD <target> timestamp=<ts>`
 * Sets the last read message ID from the server-reported position.
 */
function handleMarkread(parsed: ParsedMessage): void {
	const target = parsed.params[0];
	if (!target) return;

	// Look for timestamp= param to extract the read position.
	// Server may reply with a timestamp param; we store it as the lastReadMsgid.
	const timestampParam = parsed.params.find((p) => p.startsWith('timestamp='));
	if (timestampParam) {
		const ts = timestampParam.slice('timestamp='.length);
		if (ts) {
			setLastReadMsgid(target, ts);
		}
	}
}

function handleNamesReply(parsed: ParsedMessage): void {
	// :server 353 mynick = #channel :@op +voice regular
	// params: [mynick, '=' | '*' | '@', channel, names_string]
	const channel = parsed.params[2];
	const namesStr = parsed.params[3] ?? '';

	if (!channel) return;

	const entries = namesStr.trim().split(/\s+/).filter(Boolean);
	for (const entry of entries) {
		const { nick, prefix, modes } = parseNamesEntry(entry);
		if (nick) {
			addMember(channel, nick, '', prefix);
			// Also populate rich member state
			addRichMember(channel, {
				nick,
				account: '',
				modes,
				highestMode: computeHighestMode(modes),
				isAway: false,
				awayReason: null,
				presence: 'online',
			});
		}
	}
}

function handleEndOfNames(parsed: ParsedMessage): void {
	// :server 366 mynick #channel :End of /NAMES list
	const channel = parsed.params[1];
	if (channel) {
		setNamesLoaded(channel);
	}
}

function handleMonitorOnline(parsed: ParsedMessage): void {
	// :server 730 mynick :nick1!user@host,nick2!user@host
	const nickList = parsed.params[parsed.params.length - 1] ?? '';
	const nicks = parseMonitorNicks(nickList);
	setOnline(nicks);
	// Also update rich member presence
	for (const nick of nicks) {
		updatePresence(nick, false);
	}
}

function handleMonitorOffline(parsed: ParsedMessage): void {
	// :server 731 mynick :nick1!user@host,nick2!user@host
	const nickList = parsed.params[parsed.params.length - 1] ?? '';
	const nicks = parseMonitorNicks(nickList);
	setOffline(nicks);
	// Also update rich member presence to offline
	for (const nick of nicks) {
		setPresenceOffline(nick);
	}
}

/**
 * Handle WHO reply (352).
 * :server 352 me #channel user host server nick H/G[*][@+] :hopcount realname
 */
function handleWhoReply(parsed: ParsedMessage): void {
	// params: [me, channel, user, host, server, nick, flags, :hopcount realname]
	const channel = parsed.params[1];
	const nick = parsed.params[5];
	const flags = parsed.params[6] ?? '';
	if (!channel || !nick) return;

	const isAway = flags.startsWith('G');
	const member = getRichMember(channel, nick);
	if (member) {
		member.isAway = isAway;
		if (isAway) {
			member.presence = 'idle';
		} else {
			member.presence = 'online';
		}
	}
}

/**
 * Handle WHOX reply (354).
 * :server 354 me <token> <user> <host> <nick> <flags> <account>
 */
function handleWhoxReply(parsed: ParsedMessage): void {
	// params: [me, token, user, host, nick, flags, account]
	const nick = parsed.params[4];
	const flags = parsed.params[5] ?? '';
	const account = parsed.params[6] ?? '';
	if (!nick) return;

	const isAway = flags.startsWith('G');
	const resolvedAccount = account === '0' ? '' : account;

	// Update member across all channels where they appear
	for (const map of richMemberState.channels.values()) {
		const member = map.get(nick);
		if (member) {
			member.account = resolvedAccount;
			member.isAway = isAway;
			member.presence = isAway ? 'idle' : 'online';
		}
	}
}

/**
 * Handle AWAY (away-notify cap).
 * :nick!user@host AWAY :reason  — user is away
 * :nick!user@host AWAY          — user is back
 */
function handleAway(parsed: ParsedMessage): void {
	const nick = parsed.source?.nick ?? '';
	if (!nick) return;

	const reason = parsed.params[0] ?? '';
	if (reason) {
		updatePresence(nick, true, reason);
	} else {
		updatePresence(nick, false);
	}
}

/**
 * Register the message handler on an IRCConnection.
 * Parses each raw line and dispatches to the handler.
 */
export function registerHandler(conn: IRCConnection): void {
	conn.on('message', (line: string) => {
		const parsed = parseMessage(line);
		if (parsed.command) {
			handleMessage(parsed);
		}
	});
}

/** Clear all batch and typing state (for testing or reconnect). */
export function resetHandlerState(): void {
	activeBatches.clear();
	for (const [, timers] of typingTimers) {
		for (const [, t] of timers) {
			clearTimeout(t);
		}
	}
	typingTimers.clear();
	typingState.clear();
}
