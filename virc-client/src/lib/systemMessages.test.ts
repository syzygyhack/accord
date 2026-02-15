import { describe, it, expect } from 'vitest';
import {
	isSystemMessage,
	summarizeCollapsedGroup,
	filterSystemMessage,
	SYSTEM_TYPES,
} from './systemMessages';
import type { Message, MessageType } from '$lib/state/messages.svelte';

/** Helper to create a Message with sensible defaults. */
function makeMsg(overrides: Partial<Message> & { type: MessageType; nick: string }): Message {
	return {
		msgid: overrides.msgid ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
		nick: overrides.nick,
		account: overrides.account ?? overrides.nick,
		target: overrides.target ?? '#test',
		text: overrides.text ?? '',
		time: overrides.time ?? new Date('2026-01-15T12:00:00Z'),
		tags: overrides.tags ?? {},
		reactions: overrides.reactions ?? new Map(),
		isRedacted: overrides.isRedacted ?? false,
		type: overrides.type,
	};
}

describe('isSystemMessage', () => {
	it('returns true for join', () => {
		expect(isSystemMessage(makeMsg({ type: 'join', nick: 'alice' }))).toBe(true);
	});

	it('returns true for part', () => {
		expect(isSystemMessage(makeMsg({ type: 'part', nick: 'alice' }))).toBe(true);
	});

	it('returns true for quit', () => {
		expect(isSystemMessage(makeMsg({ type: 'quit', nick: 'alice' }))).toBe(true);
	});

	it('returns true for nick', () => {
		expect(isSystemMessage(makeMsg({ type: 'nick', nick: 'alice' }))).toBe(true);
	});

	it('returns true for mode', () => {
		expect(isSystemMessage(makeMsg({ type: 'mode', nick: 'alice' }))).toBe(true);
	});

	it('returns false for privmsg', () => {
		expect(isSystemMessage(makeMsg({ type: 'privmsg', nick: 'alice' }))).toBe(false);
	});
});

describe('summarizeCollapsedGroup', () => {
	it('summarizes a group of all joins', () => {
		const msgs = [
			makeMsg({ type: 'join', nick: 'alice' }),
			makeMsg({ type: 'join', nick: 'bob' }),
			makeMsg({ type: 'join', nick: 'carol' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('3 join events');
	});

	it('summarizes a group of all parts', () => {
		const msgs = [
			makeMsg({ type: 'part', nick: 'alice' }),
			makeMsg({ type: 'part', nick: 'bob' }),
			makeMsg({ type: 'part', nick: 'carol' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('3 part events');
	});

	it('summarizes mixed join/part events', () => {
		const msgs = [
			makeMsg({ type: 'join', nick: 'alice' }),
			makeMsg({ type: 'part', nick: 'bob' }),
			makeMsg({ type: 'join', nick: 'carol' }),
			makeMsg({ type: 'part', nick: 'dave' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('4 join/part events');
	});

	it('summarizes mixed join/part/quit events', () => {
		const msgs = [
			makeMsg({ type: 'join', nick: 'alice' }),
			makeMsg({ type: 'quit', nick: 'bob' }),
			makeMsg({ type: 'part', nick: 'carol' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('3 join/part/quit events');
	});

	it('summarizes a single mode event', () => {
		const msgs = [
			makeMsg({ type: 'mode', nick: 'alice' }),
			makeMsg({ type: 'mode', nick: 'bob' }),
			makeMsg({ type: 'mode', nick: 'carol' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('3 mode events');
	});

	it('lists distinct types alphabetically', () => {
		const msgs = [
			makeMsg({ type: 'quit', nick: 'alice' }),
			makeMsg({ type: 'join', nick: 'bob' }),
			makeMsg({ type: 'nick', nick: 'carol' }),
			makeMsg({ type: 'mode', nick: 'dave' }),
			makeMsg({ type: 'part', nick: 'eve' }),
		];
		expect(summarizeCollapsedGroup(msgs)).toBe('5 join/mode/nick/part/quit events');
	});
});

describe('filterSystemMessage', () => {
	it('returns true when display is all', () => {
		const msg = makeMsg({ type: 'join', nick: 'alice' });
		expect(filterSystemMessage(msg, 'all', new Set())).toBe(true);
	});

	it('returns false when display is none', () => {
		const msg = makeMsg({ type: 'join', nick: 'alice' });
		expect(filterSystemMessage(msg, 'none', new Set())).toBe(false);
	});

	it('returns true in smart mode when user recently spoke', () => {
		const msg = makeMsg({ type: 'join', nick: 'alice' });
		const recentSpeakers = new Set(['alice']);
		expect(filterSystemMessage(msg, 'smart', recentSpeakers)).toBe(true);
	});

	it('returns false in smart mode when user has not spoken recently', () => {
		const msg = makeMsg({ type: 'join', nick: 'alice' });
		const recentSpeakers = new Set(['bob']);
		expect(filterSystemMessage(msg, 'smart', recentSpeakers)).toBe(false);
	});

	it('always returns true for non-system messages regardless of mode', () => {
		const msg = makeMsg({ type: 'privmsg', nick: 'alice' });
		expect(filterSystemMessage(msg, 'none', new Set())).toBe(true);
		expect(filterSystemMessage(msg, 'smart', new Set())).toBe(true);
		expect(filterSystemMessage(msg, 'all', new Set())).toBe(true);
	});
});
