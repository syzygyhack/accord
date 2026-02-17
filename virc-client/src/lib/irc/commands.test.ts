import { describe, it, expect } from 'vitest';
import {
	join,
	part,
	privmsg,
	tagmsg,
	chathistory,
	markread,
	monitor,
	who,
	names,
	redact,
	topic,
	escapeTagValue,
} from './commands';
import type { IRCConnection } from './connection';

/**
 * Mock IRCConnection that records calls to send().
 * Note: the real send() appends \r\n, but the argument passed to send()
 * does NOT include \r\n. Our mock stores the raw argument.
 */
function createMockConn() {
	const sent: string[] = [];
	const conn = {
		send(line: string) {
			sent.push(line);
		},
		on() {}
	} as unknown as IRCConnection;
	return { conn, sent };
}

describe('IRC command helpers', () => {
	describe('join', () => {
		it('sends JOIN for a single channel', () => {
			const { conn, sent } = createMockConn();
			join(conn, ['#test']);
			expect(sent).toEqual(['JOIN #test']);
		});

		it('sends JOIN for multiple channels comma-separated', () => {
			const { conn, sent } = createMockConn();
			join(conn, ['#chan1', '#chan2', '#chan3']);
			expect(sent).toEqual(['JOIN #chan1,#chan2,#chan3']);
		});
	});

	describe('part', () => {
		it('sends PART without reason', () => {
			const { conn, sent } = createMockConn();
			part(conn, '#test');
			expect(sent).toEqual(['PART #test']);
		});

		it('sends PART with reason', () => {
			const { conn, sent } = createMockConn();
			part(conn, '#test', 'goodbye all');
			expect(sent).toEqual(['PART #test :goodbye all']);
		});
	});

	describe('privmsg', () => {
		it('sends PRIVMSG to channel', () => {
			const { conn, sent } = createMockConn();
			privmsg(conn, '#test', 'Hello, world!');
			expect(sent).toEqual(['PRIVMSG #test :Hello, world!']);
		});

		it('sends PRIVMSG to nick', () => {
			const { conn, sent } = createMockConn();
			privmsg(conn, 'nick', 'hi there');
			expect(sent).toEqual(['PRIVMSG nick :hi there']);
		});

		it('sends PRIVMSG with +accord/edit tag when editMsgid is provided', () => {
			const { conn, sent } = createMockConn();
			privmsg(conn, '#test', 'corrected text', 'ORIG123');
			expect(sent).toHaveLength(1);
			expect(sent[0]).toBe('@+accord/edit=ORIG123 PRIVMSG #test :corrected text');
		});

		it('sends PRIVMSG without tag when editMsgid is undefined', () => {
			const { conn, sent } = createMockConn();
			privmsg(conn, '#test', 'normal message');
			expect(sent).toEqual(['PRIVMSG #test :normal message']);
		});
	});

	describe('tagmsg', () => {
		it('sends TAGMSG with tags', () => {
			const { conn, sent } = createMockConn();
			tagmsg(conn, '#test', { '+react': '\u{1f44d}', 'msgid': 'abc123' });
			expect(sent).toHaveLength(1);
			const line = sent[0];
			expect(line).toContain('TAGMSG #test');
			expect(line).toMatch(/^@.+ TAGMSG #test$/);
			expect(line).toContain('+react=\u{1f44d}');
			expect(line).toContain('msgid=abc123');
		});
	});

	describe('chathistory', () => {
		it('sends CHATHISTORY LATEST', () => {
			const { conn, sent } = createMockConn();
			chathistory(conn, 'LATEST', '#test', '*', '50');
			expect(sent).toEqual(['CHATHISTORY LATEST #test * 50']);
		});

		it('sends CHATHISTORY BEFORE with timestamp', () => {
			const { conn, sent } = createMockConn();
			chathistory(conn, 'BEFORE', '#test', 'timestamp=2024-01-01T00:00:00Z', '50');
			expect(sent).toEqual([
				'CHATHISTORY BEFORE #test timestamp=2024-01-01T00:00:00Z 50'
			]);
		});
	});

	describe('markread', () => {
		it('sends MARKREAD without timestamp (query)', () => {
			const { conn, sent } = createMockConn();
			markread(conn, '#test');
			expect(sent).toEqual(['MARKREAD #test']);
		});

		it('sends MARKREAD with timestamp (set)', () => {
			const { conn, sent } = createMockConn();
			markread(conn, '#test', '2024-01-01T00:00:00Z');
			expect(sent).toEqual(['MARKREAD #test timestamp=2024-01-01T00:00:00Z']);
		});
	});

	describe('monitor', () => {
		it('sends MONITOR + with nicks', () => {
			const { conn, sent } = createMockConn();
			monitor(conn, '+', ['nick1', 'nick2']);
			expect(sent).toEqual(['MONITOR + nick1,nick2']);
		});

		it('sends MONITOR - with nicks', () => {
			const { conn, sent } = createMockConn();
			monitor(conn, '-', ['nick1']);
			expect(sent).toEqual(['MONITOR - nick1']);
		});
	});

	describe('who', () => {
		it('sends WHO target', () => {
			const { conn, sent } = createMockConn();
			who(conn, '#test');
			expect(sent).toEqual(['WHO #test']);
		});
	});

	describe('names', () => {
		it('sends NAMES channel', () => {
			const { conn, sent } = createMockConn();
			names(conn, '#test');
			expect(sent).toEqual(['NAMES #test']);
		});
	});

	describe('redact', () => {
		it('sends REDACT without reason', () => {
			const { conn, sent } = createMockConn();
			redact(conn, '#test', 'abc123');
			expect(sent).toEqual(['REDACT #test abc123']);
		});

		it('sends REDACT with reason', () => {
			const { conn, sent } = createMockConn();
			redact(conn, '#test', 'abc123', 'spam message');
			expect(sent).toEqual(['REDACT #test abc123 :spam message']);
		});
	});

	describe('escapeTagValue', () => {
		it('escapes backslashes first', () => {
			expect(escapeTagValue('\\')).toBe('\\\\');
		});

		it('escapes semicolons as \\;', () => {
			expect(escapeTagValue(';')).toBe('\\;');
			expect(escapeTagValue('a;b;c')).toBe('a\\;b\\;c');
		});

		it('escapes spaces as \\s', () => {
			expect(escapeTagValue('hello world')).toBe('hello\\sworld');
		});

		it('escapes CR as \\r', () => {
			expect(escapeTagValue('\r')).toBe('\\r');
		});

		it('escapes LF as \\n', () => {
			expect(escapeTagValue('\n')).toBe('\\n');
		});

		it('handles combined escapes in correct order', () => {
			// backslash must be escaped first to avoid double-escaping
			expect(escapeTagValue('a\\;b c\r\n')).toBe('a\\\\\\;b\\sc\\r\\n');
		});

		it('passes through safe characters unchanged', () => {
			expect(escapeTagValue('hello123')).toBe('hello123');
			expect(escapeTagValue('')).toBe('');
		});
	});

	describe('topic', () => {
		it('sends TOPIC query (no new topic)', () => {
			const { conn, sent } = createMockConn();
			topic(conn, '#test');
			expect(sent).toEqual(['TOPIC #test']);
		});

		it('sends TOPIC set with new topic', () => {
			const { conn, sent } = createMockConn();
			topic(conn, '#test', 'New channel topic');
			expect(sent).toEqual(['TOPIC #test :New channel topic']);
		});

		it('sends TOPIC set with empty string to clear topic', () => {
			const { conn, sent } = createMockConn();
			topic(conn, '#test', '');
			// Empty string starts with ':' via formatMessage trailing logic
			expect(sent).toEqual(['TOPIC #test :']);
		});
	});
});
