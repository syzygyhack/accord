/**
 * Central IRC message dispatcher.
 *
 * Takes parsed IRC messages and routes them to the appropriate state
 * update functions. Register this on an IRCConnection's 'message' event.
 */

import type { IRCConnection } from './connection';
import { parseMessage, type ParsedMessage } from './parser';
import { MODE_ORDER } from '$lib/constants';
import { appSettings } from '$lib/state/appSettings.svelte';
import { pushRawLine } from '$lib/state/rawIrcLog.svelte';
import {
	addMessage,
	clearChannel as clearMessages,
	redactMessage,
	addReaction,
	removeReaction,
	getMessage,
	prependMessages,
	appendMessages,
	getMessages,
	notifyHistoryBatchComplete,
	replaceOptimisticMessage,
	updateMessageText,
	type Message,
	type MessageType,
} from '../state/messages.svelte';
import {
	addMember,
	removeMember,
	removeMemberFromAll,
	renameMember,
	getChannelsForNick,
	getChannel,
	setTopic,
	setNamesLoaded,
	updateDMLastMessage,
	isDMTarget,
	getActiveChannel,
	removeChannel,
	setActiveChannel,
	channelUIState,
} from '../state/channels.svelte';
import { setOnline, setOffline } from '../state/presence.svelte';
import { incrementUnread, setLastReadMsgid } from '../state/notifications.svelte';
import { userState } from '../state/user.svelte';
import {
	setTyping as setTypingStore,
	clearTyping as clearTypingStore,
	resetTyping,
} from '../state/typing.svelte';
import {
	memberState as richMemberState,
	addMember as addRichMember,
	removeMember as removeRichMember,
	removeMemberFromAll as removeRichMemberFromAll,
	renameMember as renameRichMember,
	updatePresence,
	setPresenceOffline,
	getMember as getRichMember,
	updateMemberModes,
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

/** Typing timeout timers: target -> Map<nick, timeout handle>. */
const typingTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

const TYPING_TIMEOUT_MS = 6_000;

/**
 * Counter of expected self-JOIN messages to suppress during reconnect.
 * Decremented on each self-JOIN; when 0, JOINs produce system messages normally.
 */
let _suppressSelfJoinCount = 0;

/** Cached mention detection regex — rebuilt only when account changes. */
let _mentionRegex: RegExp | null = null;
let _mentionAccount = '';

function getMentionRegex(account: string): RegExp | null {
	if (!account) return null;
	if (account !== _mentionAccount) {
		_mentionAccount = account;
		const escaped = account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		_mentionRegex = new RegExp(`\\b@${escaped}\\b`, 'i');
	}
	return _mentionRegex;
}

/**
 * Mark a user as typing. Updates the shared reactive store and sets
 * a timeout to auto-clear after TYPING_TIMEOUT_MS.
 */
function setTyping(target: string, nick: string): void {
	setTypingStore(target, nick);

	// Manage auto-clear timers
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
	clearTypingStore(target, nick);

	const timers = typingTimers.get(target);
	if (timers) {
		const t = timers.get(nick);
		if (t) clearTimeout(t);
		timers.delete(nick);
		if (timers.size === 0) typingTimers.delete(target);
	}
}

/**
 * Resolve the buffer target for a message. For DMs (target = our nick),
 * use the sender's nick as the buffer key so all DMs with that person
 * end up in the same buffer. Case-insensitive per RFC 2812.
 */
function resolveBufferTarget(rawTarget: string, senderNick: string): { bufferTarget: string; isIncomingDM: boolean } {
	const isIncomingDM = rawTarget.toLowerCase() === userState.nick?.toLowerCase();
	return {
		bufferTarget: isIncomingDM ? senderNick : rawTarget,
		isIncomingDM,
	};
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

/** Compute the highest mode from an array of mode prefixes. */
function computeHighestMode(modes: string[]): string | null {
	for (const mode of MODE_ORDER) {
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
		case 'KICK':
			handleKick(parsed);
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
		case 'PING':
			// Respond to server PING to keep the connection alive
			if (activeConn) {
				const token = parsed.params[0] ?? '';
				activeConn.send(`PONG :${token}`);
			}
			break;
		case '001': // RPL_WELCOME — confirmed nick from server
			handleWelcome(parsed);
			break;
		case 'ERROR':
			// Server error before disconnect — log it
			console.error('IRC ERROR:', parsed.params[0] ?? '');
			break;
		default:
			break;
	}
}

function handlePrivmsg(parsed: ParsedMessage): void {
	const rawTarget = parsed.params[0];
	if (!rawTarget) return;
	const senderNick = parsed.source?.nick ?? '';
	const senderAccount = parsed.tags['account'] ?? '';

	const { bufferTarget, isIncomingDM } = resolveBufferTarget(rawTarget, senderNick);
	const msg = privmsgToMessage(parsed, bufferTarget);

	// Clear typing indicator for this user
	if (msg.nick) {
		clearTyping(bufferTarget, msg.nick);
	}

	// Handle +accord/edit: update original message in-place instead of adding new
	const editOriginalMsgid = parsed.tags['+accord/edit'];
	if (editOriginalMsgid) {
		const updated = updateMessageText(bufferTarget, editOriginalMsgid, msg.text, msg.msgid);
		if (updated) {
			// Edit applied in-place — don't add a new message
			return;
		}
		// Original not found in buffer — fall through to add as new message
	}

	// For own echo-messages, replace the optimistic placeholder instead of adding a duplicate
	const isOwnEcho = senderNick === userState.nick;
	if (isOwnEcho && replaceOptimisticMessage(bufferTarget, msg)) {
		// Optimistic message was replaced — skip addMessage
	} else {
		addMessage(bufferTarget, msg);
	}

	// If this is an incoming DM, ensure a DM conversation entry exists
	if (isIncomingDM && senderNick) {
		const preview = msg.text.length > 80 ? msg.text.slice(0, 80) + '...' : msg.text;
		updateDMLastMessage(senderNick, senderAccount, preview);
	}

	// Track unread if this message is for a non-active channel/DM.
	// Skip own messages (echoed back via echo-message cap).
	const isOwnMessage = senderNick === userState.nick;
	const activeChannel = getActiveChannel();
	if (bufferTarget !== activeChannel && !isOwnMessage) {
		const myAccount = userState.account ?? '';
		// DMs are always considered mentions; word-boundary check for @mentions
		const mentionRe = getMentionRegex(myAccount);
		const isMention = isIncomingDM || (mentionRe !== null && mentionRe.test(msg.text));
		incrementUnread(bufferTarget, isMention);
	}
}

function handleTagmsg(parsed: ParsedMessage): void {
	const rawTarget = parsed.params[0];
	if (!rawTarget) return;
	const nick = parsed.source?.nick ?? '';
	const { bufferTarget: target } = resolveBufferTarget(rawTarget, nick);

	// Handle reactions: +draft/react tag (toggle semantics)
	const reactEmoji = parsed.tags['+draft/react'];
	if (reactEmoji) {
		const replyMsgid = parsed.tags['+draft/reply'];
		if (replyMsgid) {
			const account = parsed.tags['account'] ?? '';
			// Toggle: if account already reacted with this emoji, remove it
			const msg = getMessage(target, replyMsgid);
			const existing = msg?.reactions.get(reactEmoji);
			if (existing && existing.has(account)) {
				removeReaction(target, replyMsgid, reactEmoji, account);
			} else {
				addReaction(target, replyMsgid, reactEmoji, account);
			}
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
	const rawTarget = parsed.params[0];
	const msgid = parsed.params[1];
	if (!rawTarget || !msgid) return;

	// DM buffer routing: if the target is our nick, the redact applies to
	// a message in the sender's DM buffer.
	const senderNick = parsed.source?.nick ?? '';
	const { bufferTarget } = resolveBufferTarget(rawTarget, senderNick);
	redactMessage(bufferTarget, msgid);
}

function handleJoin(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	if (!channel) return;
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

	// Skip system message for own joins during reconnect (Discord-style: users are always in channels)
	const isSelf = nick === userState.nick;
	if (isSelf && _suppressSelfJoinCount > 0) {
		_suppressSelfJoinCount--;
		return;
	}

	// Add system message to channel buffer
	const msg = systemMessage('join', channel, nick, `${nick} has joined ${channel}`, parsed);
	addMessage(channel, msg);
}

function handlePart(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	if (!channel) return;
	const nick = parsed.source?.nick ?? '';
	removeMember(channel, nick);
	removeRichMember(channel, nick);

	if (nick === userState.nick) {
		// Self-PART: remove channel from sidebar and clear its state
		clearMessages(channel);
		removeChannel(channel);
		if (getActiveChannel() === channel) {
			// Switch to the first available text channel
			const textChannels = channelUIState.categories
				.filter((c) => !c.voice)
				.flatMap((c) => c.channels);
			setActiveChannel(textChannels[0] ?? null);
		}
		return;
	}

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

function handleKick(parsed: ParsedMessage): void {
	// :op!user@host KICK #channel target :reason
	const channel = parsed.params[0];
	const target = parsed.params[1] ?? '';
	const reason = parsed.params[2] ? ` (${parsed.params[2]})` : '';
	if (!channel || !target) return;

	removeMember(channel, target);
	removeRichMember(channel, target);

	if (target === userState.nick) {
		// We were kicked — remove channel from sidebar
		clearMessages(channel);
		removeChannel(channel);
		if (getActiveChannel() === channel) {
			const textChannels = channelUIState.categories
				.filter((c) => !c.voice)
				.flatMap((c) => c.channels);
			setActiveChannel(textChannels[0] ?? null);
		}
		return;
	}

	const kicker = parsed.source?.nick ?? '';
	const msg = systemMessage('part', channel, target, `${target} was kicked by ${kicker}${reason}`, parsed);
	addMessage(channel, msg);
}

/** Handle RPL_WELCOME (001) — update confirmed nick from server. */
function handleWelcome(parsed: ParsedMessage): void {
	// :server 001 confirmedNick :Welcome to the network
	const confirmedNick = parsed.params[0];
	if (confirmedNick && confirmedNick !== userState.nick) {
		userState.nick = confirmedNick;
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

/** Map channel mode letters to their prefix characters. */
const MODE_TO_PREFIX: Record<string, string> = {
	q: '~',
	a: '&',
	o: '@',
	h: '%',
	v: '+',
};

/**
 * Channel modes that always consume a parameter.
 * Without tracking these, paramIdx drifts when the server sends mixed
 * mode strings like "+bo nick banmask" (ban + op in a single MODE).
 *
 * List covers standard RFC 2811 type-A (list) and type-B (always-param)
 * modes. Type-C modes (param on set only) are handled via `adding`.
 */
const PARAM_MODES_ALWAYS = new Set(['b', 'e', 'I', 'k']);
/** Modes that take a param only when being set (+), not when unset (-). */
const PARAM_MODES_SET_ONLY = new Set(['l', 'j', 'f']);

function handleMode(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	if (!channel || !channel.startsWith('#')) return; // Only handle channel modes

	const modeStr = parsed.params[1] ?? '';
	const nick = parsed.source?.nick ?? 'server';
	const text = `${nick} sets mode ${parsed.params.slice(1).join(' ')}`;
	const msg = systemMessage('mode', channel, nick, text, parsed);
	addMessage(channel, msg);

	// Parse mode changes and update member state
	let adding = true;
	let paramIdx = 2; // params after channel and mode string

	for (const char of modeStr) {
		if (char === '+') {
			adding = true;
			continue;
		}
		if (char === '-') {
			adding = false;
			continue;
		}

		const prefix = MODE_TO_PREFIX[char];
		if (prefix && paramIdx < parsed.params.length) {
			const targetNick = parsed.params[paramIdx];
			paramIdx++;

			// Update rich member state
			const member = getRichMember(channel, targetNick);
			if (member) {
				if (adding) {
					if (!member.modes.includes(prefix)) {
						member.modes = [...member.modes, prefix];
					}
				} else {
					member.modes = member.modes.filter((m) => m !== prefix);
				}
				updateMemberModes(channel, targetNick, member.modes);
			}

			// Update simple channel member prefix
			const ch = getChannel(channel);
			if (ch) {
				const simpleMember = ch.members.get(targetNick);
				if (simpleMember) {
					if (adding) {
						if (!simpleMember.prefix.includes(prefix)) {
							simpleMember.prefix += prefix;
						}
					} else {
						simpleMember.prefix = simpleMember.prefix.replace(prefix, '');
					}
				}
			}
		} else if (PARAM_MODES_ALWAYS.has(char)) {
			// Consume the parameter even though we don't process this mode
			paramIdx++;
		} else if (adding && PARAM_MODES_SET_ONLY.has(char)) {
			// These modes only take a param when being set
			paramIdx++;
		}
	}
}

function handleTopic(parsed: ParsedMessage): void {
	const channel = parsed.params[0];
	if (!channel) return;
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
		const rawTarget = parsed.params[0];
		if (!rawTarget) return;
		const senderNick = parsed.source?.nick ?? '';

		// Apply the same DM buffer routing as live messages: if the message
		const { bufferTarget } = resolveBufferTarget(rawTarget, senderNick);

		const msg = privmsgToMessage(parsed, bufferTarget);

		// Handle +accord/edit in history: update the earlier message in the
		// batch instead of adding a duplicate.
		const editOriginalMsgid = parsed.tags['+accord/edit'];
		if (editOriginalMsgid) {
			const original = batch.messages.find((m) => m.msgid === editOriginalMsgid);
			if (original) {
				original.text = msg.text;
				original.isEdited = true;
				return;
			}
			// Original not in batch — fall through and add as a new message
		}

		batch.messages.push(msg);
	} else if (parsed.command === 'REDACT') {
		// Apply REDACT within the batch: mark the referenced message as redacted
		const msgid = parsed.params[1];
		if (msgid) {
			const target = batch.messages.find((m) => m.msgid === msgid);
			if (target) {
				target.isRedacted = true;
				target.text = '';
			}
		}
	}
	// TAGMSG (reactions) within batches are uncommon in chathistory;
	// handled by the live handler once the batch is finalized.
}

function finalizeBatch(batch: BatchState): void {
	if (batch.type === 'chathistory' && batch.target) {
		let resolvedTarget = batch.target;
		if (batch.messages.length > 0) {
			// Determine the correct buffer target from the messages
			// (they already have DM-resolved targets from handleBatchedMessage).
			const bufferTarget = batch.messages[0].target;
			resolvedTarget = bufferTarget;

			// Deduplicate: echo-message may have already added some of these
			const existing = getMessages(bufferTarget);
			const existingIds = new Set(existing.map((m) => m.msgid));
			const newMessages = batch.messages.filter((m) => !existingIds.has(m.msgid));

			if (newMessages.length > 0) {
				// Determine whether to prepend (older history) or append (gap-fill).
				// Compare the batch's oldest message against the buffer's newest.
				const batchOldest = newMessages[0].time;
				const bufferNewest = existing.length > 0 ? existing[existing.length - 1].time : null;

				if (bufferNewest && batchOldest > bufferNewest) {
					// Batch messages are newer than buffer → append (gap-fill / AFTER)
					appendMessages(bufferTarget, newMessages);
				} else {
					// Batch messages are older than buffer → prepend (BEFORE / LATEST)
					prependMessages(bufferTarget, newMessages);
				}
			}
		}
		// Always signal completion so the UI can clear its loading state,
		// even when the batch is empty (no older messages exist).
		// Pass the target channel so the UI can ignore batches for other channels.
		notifyHistoryBatchComplete(resolvedTarget);
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
	// Use updatePresence which calls notify() for reactivity
	updatePresence(nick, isAway);
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

	// Update account field directly, then use updatePresence for reactivity
	for (const map of richMemberState.channels.values()) {
		const member = map.get(nick);
		if (member && resolvedAccount) {
			member.account = resolvedAccount;
		}
	}
	updatePresence(nick, isAway);
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

/** Reference to the currently registered handler so it can be removed on reconnect. */
let activeHandler: ((line: string) => void) | null = null;
let activeConn: IRCConnection | null = null;

/**
 * Register the message handler on an IRCConnection.
 * Parses each raw line and dispatches to the handler.
 * Safe to call multiple times (e.g. on reconnect) — removes the previous
 * handler before attaching a new one.
 */
export function registerHandler(conn: IRCConnection): void {
	// Remove previous handler if it exists
	if (activeHandler && activeConn) {
		activeConn.off('message', activeHandler);
	}

	activeHandler = (line: string) => {
		if (appSettings.showRawIrc) {
			pushRawLine('in', line);
		}
		const parsed = parseMessage(line);
		if (parsed.command) {
			handleMessage(parsed);
		}
	};
	activeConn = conn;
	conn.on('message', activeHandler);
}

/** Set the number of expected self-JOINs to suppress (during reconnect). */
export function setSuppressSelfJoins(count: number): void {
	_suppressSelfJoinCount = count;
}

/** Clear all batch, typing, and handler state (for testing or reconnect). */
export function resetHandlerState(): void {
	activeBatches.clear();
	for (const [, timers] of typingTimers) {
		for (const [, t] of timers) {
			clearTimeout(t);
		}
	}
	typingTimers.clear();
	resetTyping();
	_suppressSelfJoinCount = 0;
	_mentionRegex = null;
	_mentionAccount = '';
	activeHandler = null;
	activeConn = null;
}
