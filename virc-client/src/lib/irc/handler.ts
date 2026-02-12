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
} from '../state/messages.svelte';
import {
	addMember,
	removeMember,
	removeMemberFromAll,
	setTopic,
	setNamesLoaded,
} from '../state/channels.svelte';
import { setOnline, setOffline } from '../state/presence.svelte';

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
	};
}

/**
 * Parse NAMES reply prefixes. Strips mode prefix chars (@, +, %, ~, &)
 * and returns the nick and its prefix string.
 */
function parseNamesEntry(entry: string): { nick: string; prefix: string } {
	let prefix = '';
	let i = 0;
	const prefixChars = '@+%~&';

	while (i < entry.length && prefixChars.includes(entry[i])) {
		prefix += entry[i];
		i++;
	}

	// userhost-in-names: nick!user@host — extract just the nick
	const rest = entry.slice(i);
	const bangIdx = rest.indexOf('!');
	const nick = bangIdx !== -1 ? rest.slice(0, bangIdx) : rest;

	return { nick, prefix };
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
}

function handlePart(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	const nick = parsed.source?.nick ?? '';
	removeMember(channel, nick);
}

function handleQuit(parsed: ParsedMessage): void {
	const nick = parsed.source?.nick ?? '';
	removeMemberFromAll(nick);
}

function handleTopic(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	const topic = parsed.params[1] ?? '';
	setTopic(channel, topic);
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

function handleNamesReply(parsed: ParsedMessage): void {
	// :server 353 mynick = #channel :@op +voice regular
	// params: [mynick, '=' | '*' | '@', channel, names_string]
	const channel = parsed.params[2];
	const namesStr = parsed.params[3] ?? '';

	if (!channel) return;

	const entries = namesStr.trim().split(/\s+/).filter(Boolean);
	for (const entry of entries) {
		const { nick, prefix } = parseNamesEntry(entry);
		if (nick) {
			addMember(channel, nick, '', prefix);
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
}

function handleMonitorOffline(parsed: ParsedMessage): void {
	// :server 731 mynick :nick1!user@host,nick2!user@host
	const nickList = parsed.params[parsed.params.length - 1] ?? '';
	const nicks = parseMonitorNicks(nickList);
	setOffline(nicks);
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
