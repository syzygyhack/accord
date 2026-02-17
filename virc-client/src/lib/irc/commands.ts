import type { IRCConnection } from './connection';
import { formatMessage } from './parser';

/**
 * Escape a tag value per IRCv3 message-tags spec.
 * Characters that must be escaped: \ ; SPACE CR LF
 */
export function escapeTagValue(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/ /g, '\\s')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n');
}

/** Join one or more channels. */
export function join(conn: IRCConnection, channels: string[]): void {
	conn.send(formatMessage('JOIN', channels.join(',')));
}

/** Part a channel with an optional reason. */
export function part(conn: IRCConnection, channel: string, reason?: string): void {
	if (reason) {
		conn.send(formatMessage('PART', channel, reason));
	} else {
		conn.send(formatMessage('PART', channel));
	}
}

/** Send a PRIVMSG to a target (channel or nick). Optionally attach a +accord/edit tag for edits. Returns false if send failed. */
export function privmsg(conn: IRCConnection, target: string, text: string, editMsgid?: string): boolean {
	if (editMsgid) {
		return conn.send(`@+accord/edit=${escapeTagValue(editMsgid)} ${formatMessage('PRIVMSG', target, text)}`);
	} else {
		return conn.send(formatMessage('PRIVMSG', target, text));
	}
}

/**
 * Send a TAGMSG to a target with the given tags.
 * Format: `@tag1=val1;tag2=val2 TAGMSG target`
 */
export function tagmsg(conn: IRCConnection, target: string, tags: Record<string, string>): void {
	const tagStr = Object.entries(tags)
		.map(([k, v]) => (v ? `${k}=${escapeTagValue(v)}` : k))
		.join(';');
	conn.send(`@${tagStr} ${formatMessage('TAGMSG', target)}`);
}

/**
 * Send a CHATHISTORY command.
 * Usage: `CHATHISTORY <subcommand> <target> <...args>`
 */
export function chathistory(
	conn: IRCConnection,
	subcommand: string,
	target: string,
	...args: string[]
): void {
	conn.send(formatMessage('CHATHISTORY', subcommand, target, ...args));
}

/**
 * Send a MARKREAD command.
 * Without timestamp: query current read marker.
 * With timestamp: set read marker.
 */
export function markread(conn: IRCConnection, target: string, timestamp?: string): void {
	if (timestamp) {
		conn.send(formatMessage('MARKREAD', target, `timestamp=${timestamp}`));
	} else {
		conn.send(formatMessage('MARKREAD', target));
	}
}

/** Add or remove nicks from MONITOR. */
export function monitor(conn: IRCConnection, action: '+' | '-', nicks: string[]): void {
	conn.send(formatMessage('MONITOR', action, nicks.join(',')));
}

/** Send a WHO query. */
export function who(conn: IRCConnection, target: string): void {
	conn.send(formatMessage('WHO', target));
}

/** Send a NAMES query. */
export function names(conn: IRCConnection, channel: string): void {
	conn.send(formatMessage('NAMES', channel));
}

/**
 * Send a REDACT command to redact a message.
 * Format: `REDACT <target> <msgid> [:<reason>]`
 */
export function redact(
	conn: IRCConnection,
	target: string,
	msgid: string,
	reason?: string
): void {
	if (reason) {
		conn.send(formatMessage('REDACT', target, msgid, reason));
	} else {
		conn.send(formatMessage('REDACT', target, msgid));
	}
}

/**
 * Get or set a channel topic.
 * Without newTopic: queries the current topic.
 * With newTopic: sets the topic.
 */
export function topic(conn: IRCConnection, channel: string, newTopic?: string): void {
	if (newTopic !== undefined) {
		// formatMessage doesn't handle empty trailing params correctly,
		// so we always use trailing syntax for topic setting.
		conn.send(`TOPIC ${channel} :${newTopic}`);
	} else {
		conn.send(formatMessage('TOPIC', channel));
	}
}
