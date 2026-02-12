import { describe, it, expect, beforeEach } from 'vitest';
import {
	messageState,
	addMessage,
	getMessage,
	getMessages,
	redactMessage,
	addReaction,
	removeReaction,
	prependMessages,
	getCursors,
	clearChannel,
	resetMessages,
	type Message,
} from './messages.svelte';

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		msgid: overrides.msgid ?? 'msg-1',
		nick: overrides.nick ?? 'alice',
		account: overrides.account ?? 'alice',
		target: overrides.target ?? '#test',
		text: overrides.text ?? 'hello',
		time: overrides.time ?? new Date('2025-01-01T00:00:00Z'),
		tags: overrides.tags ?? {},
		replyTo: overrides.replyTo,
		reactions: overrides.reactions ?? new Map(),
		isRedacted: overrides.isRedacted ?? false,
	};
}

describe('message state', () => {
	beforeEach(() => {
		resetMessages();
	});

	describe('addMessage', () => {
		it('adds a message to the channel buffer', () => {
			const msg = makeMessage();
			addMessage('#test', msg);
			expect(getMessages('#test')).toHaveLength(1);
			expect(getMessages('#test')[0]).toBe(msg);
		});

		it('creates the channel buffer if it does not exist', () => {
			expect(getMessages('#new')).toEqual([]);
			addMessage('#new', makeMessage({ target: '#new' }));
			expect(getMessages('#new')).toHaveLength(1);
		});

		it('evicts oldest messages when exceeding 500', () => {
			for (let i = 0; i < 505; i++) {
				addMessage('#test', makeMessage({ msgid: `msg-${i}` }));
			}
			const msgs = getMessages('#test');
			expect(msgs).toHaveLength(500);
			// Oldest should be msg-5 (first 5 evicted)
			expect(msgs[0].msgid).toBe('msg-5');
			expect(msgs[499].msgid).toBe('msg-504');
		});
	});

	describe('getMessage', () => {
		it('finds a message by msgid', () => {
			addMessage('#test', makeMessage({ msgid: 'abc' }));
			addMessage('#test', makeMessage({ msgid: 'def' }));
			const found = getMessage('#test', 'abc');
			expect(found).not.toBeNull();
			expect(found!.msgid).toBe('abc');
		});

		it('returns null for unknown msgid', () => {
			addMessage('#test', makeMessage({ msgid: 'abc' }));
			expect(getMessage('#test', 'xyz')).toBeNull();
		});

		it('returns null for unknown channel', () => {
			expect(getMessage('#nope', 'abc')).toBeNull();
		});
	});

	describe('getMessages', () => {
		it('returns empty array for unknown channel', () => {
			expect(getMessages('#unknown')).toEqual([]);
		});

		it('returns messages in insertion order', () => {
			addMessage('#test', makeMessage({ msgid: 'a' }));
			addMessage('#test', makeMessage({ msgid: 'b' }));
			addMessage('#test', makeMessage({ msgid: 'c' }));
			const ids = getMessages('#test').map((m) => m.msgid);
			expect(ids).toEqual(['a', 'b', 'c']);
		});
	});

	describe('redactMessage', () => {
		it('marks a message as redacted', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			expect(getMessage('#test', 'r1')!.isRedacted).toBe(false);
			redactMessage('#test', 'r1');
			expect(getMessage('#test', 'r1')!.isRedacted).toBe(true);
		});

		it('does nothing for unknown msgid', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			redactMessage('#test', 'unknown');
			expect(getMessage('#test', 'r1')!.isRedacted).toBe(false);
		});
	});

	describe('reactions', () => {
		it('adds a reaction to a message', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			addReaction('#test', 'r1', '👍', 'bob');
			const msg = getMessage('#test', 'r1')!;
			expect(msg.reactions.has('👍')).toBe(true);
			expect(msg.reactions.get('👍')!.has('bob')).toBe(true);
		});

		it('tracks multiple accounts per emoji', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			addReaction('#test', 'r1', '👍', 'bob');
			addReaction('#test', 'r1', '👍', 'carol');
			const accounts = getMessage('#test', 'r1')!.reactions.get('👍')!;
			expect(accounts.size).toBe(2);
			expect(accounts.has('bob')).toBe(true);
			expect(accounts.has('carol')).toBe(true);
		});

		it('tracks multiple emojis per message', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			addReaction('#test', 'r1', '👍', 'bob');
			addReaction('#test', 'r1', '❤️', 'carol');
			const reactions = getMessage('#test', 'r1')!.reactions;
			expect(reactions.size).toBe(2);
		});

		it('removes a reaction', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			addReaction('#test', 'r1', '👍', 'bob');
			addReaction('#test', 'r1', '👍', 'carol');
			removeReaction('#test', 'r1', '👍', 'bob');
			const accounts = getMessage('#test', 'r1')!.reactions.get('👍')!;
			expect(accounts.size).toBe(1);
			expect(accounts.has('bob')).toBe(false);
			expect(accounts.has('carol')).toBe(true);
		});

		it('removes the emoji key when last account is removed', () => {
			addMessage('#test', makeMessage({ msgid: 'r1' }));
			addReaction('#test', 'r1', '👍', 'bob');
			removeReaction('#test', 'r1', '👍', 'bob');
			expect(getMessage('#test', 'r1')!.reactions.has('👍')).toBe(false);
		});

		it('does nothing for unknown message', () => {
			addReaction('#test', 'nope', '👍', 'bob');
			removeReaction('#test', 'nope', '👍', 'bob');
			// No error thrown
		});
	});

	describe('prependMessages', () => {
		it('prepends messages for history loading', () => {
			addMessage('#test', makeMessage({ msgid: 'new-1' }));
			prependMessages('#test', [
				makeMessage({ msgid: 'old-1' }),
				makeMessage({ msgid: 'old-2' }),
			]);
			const ids = getMessages('#test').map((m) => m.msgid);
			expect(ids).toEqual(['old-1', 'old-2', 'new-1']);
		});

		it('evicts from the end when prepending exceeds capacity', () => {
			// Fill with 498 messages
			for (let i = 0; i < 498; i++) {
				addMessage('#test', makeMessage({ msgid: `existing-${i}` }));
			}
			// Prepend 5, total would be 503, so last 3 existing get cut
			prependMessages('#test', [
				makeMessage({ msgid: 'hist-0' }),
				makeMessage({ msgid: 'hist-1' }),
				makeMessage({ msgid: 'hist-2' }),
				makeMessage({ msgid: 'hist-3' }),
				makeMessage({ msgid: 'hist-4' }),
			]);
			const msgs = getMessages('#test');
			expect(msgs).toHaveLength(500);
			expect(msgs[0].msgid).toBe('hist-0');
			expect(msgs[4].msgid).toBe('hist-4');
			expect(msgs[5].msgid).toBe('existing-0');
		});

		it('creates the channel if it does not exist', () => {
			prependMessages('#new', [makeMessage({ msgid: 'h1', target: '#new' })]);
			expect(getMessages('#new')).toHaveLength(1);
			expect(getMessages('#new')[0].msgid).toBe('h1');
		});
	});

	describe('cursors', () => {
		it('returns null cursors for unknown channel', () => {
			const c = getCursors('#nope');
			expect(c.oldestMsgid).toBeNull();
			expect(c.newestMsgid).toBeNull();
		});

		it('tracks oldest and newest msgid after addMessage', () => {
			addMessage('#test', makeMessage({ msgid: 'first' }));
			addMessage('#test', makeMessage({ msgid: 'second' }));
			addMessage('#test', makeMessage({ msgid: 'third' }));
			const c = getCursors('#test');
			expect(c.oldestMsgid).toBe('first');
			expect(c.newestMsgid).toBe('third');
		});

		it('updates oldest after eviction', () => {
			for (let i = 0; i < 502; i++) {
				addMessage('#test', makeMessage({ msgid: `m-${i}` }));
			}
			const c = getCursors('#test');
			expect(c.oldestMsgid).toBe('m-2');
			expect(c.newestMsgid).toBe('m-501');
		});

		it('updates after prependMessages', () => {
			addMessage('#test', makeMessage({ msgid: 'new-1' }));
			prependMessages('#test', [makeMessage({ msgid: 'old-1' })]);
			const c = getCursors('#test');
			expect(c.oldestMsgid).toBe('old-1');
			expect(c.newestMsgid).toBe('new-1');
		});
	});

	describe('clearChannel', () => {
		it('removes all messages and cursors for a channel', () => {
			addMessage('#test', makeMessage({ msgid: 'a' }));
			clearChannel('#test');
			expect(getMessages('#test')).toEqual([]);
			const c = getCursors('#test');
			expect(c.oldestMsgid).toBeNull();
		});
	});

	describe('resetMessages', () => {
		it('clears all channels', () => {
			addMessage('#a', makeMessage({ msgid: '1', target: '#a' }));
			addMessage('#b', makeMessage({ msgid: '2', target: '#b' }));
			resetMessages();
			expect(getMessages('#a')).toEqual([]);
			expect(getMessages('#b')).toEqual([]);
		});
	});
});
