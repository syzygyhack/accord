import { describe, it, expect, beforeEach } from 'vitest';
import {
	addMessage,
	getMessage,
	getMessages,
	redactMessage,
	addReaction,
	removeReaction,
	prependMessages,
	appendMessages,
	replaceOptimisticMessage,
	getCursors,
	clearChannel,
	resetMessages,
	updateSendState,
	updateMessageText,
	resolveEditChain,
	pinMessage,
	unpinMessage,
	getPinnedMessages,
	isPinned,
	searchMessages,
	getThread,
	getThreadRoot,
	getThreadCount,
	hasThread,
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
		type: overrides.type ?? 'privmsg',
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

		it('evicts newest existing messages when prepend exceeds capacity', () => {
			// Fill with 498 messages
			for (let i = 0; i < 498; i++) {
				addMessage('#test', makeMessage({ msgid: `existing-${i}` }));
			}
			// Prepend 5, total would be 503, so newest 3 existing get trimmed
			prependMessages('#test', [
				makeMessage({ msgid: 'hist-0' }),
				makeMessage({ msgid: 'hist-1' }),
				makeMessage({ msgid: 'hist-2' }),
				makeMessage({ msgid: 'hist-3' }),
				makeMessage({ msgid: 'hist-4' }),
			]);
			const msgs = getMessages('#test');
			expect(msgs).toHaveLength(500);
			// All prepended history preserved
			expect(msgs[0].msgid).toBe('hist-0');
			expect(msgs[4].msgid).toBe('hist-4');
			// Existing messages start after history
			expect(msgs[5].msgid).toBe('existing-0');
			// Newest 3 existing messages trimmed (existing-495, -496, -497 gone)
			expect(msgs[msgs.length - 1].msgid).toBe('existing-494');
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

	describe('message types', () => {
		it('stores nick type messages', () => {
			addMessage('#test', makeMessage({ msgid: 'n1', type: 'nick', text: 'alice is now known as bob' }));
			const msg = getMessage('#test', 'n1');
			expect(msg).not.toBeNull();
			expect(msg!.type).toBe('nick');
		});

		it('stores mode type messages', () => {
			addMessage('#test', makeMessage({ msgid: 'm1', type: 'mode', text: 'alice sets mode +o bob' }));
			const msg = getMessage('#test', 'm1');
			expect(msg).not.toBeNull();
			expect(msg!.type).toBe('mode');
		});
	});

	describe('updateSendState', () => {
		it('sets sendState on a message', () => {
			addMessage('#test', makeMessage({ msgid: 'send-1' }));
			expect(getMessage('#test', 'send-1')!.sendState).toBeUndefined();

			updateSendState('#test', 'send-1', 'sending');
			expect(getMessage('#test', 'send-1')!.sendState).toBe('sending');

			updateSendState('#test', 'send-1', 'sent');
			expect(getMessage('#test', 'send-1')!.sendState).toBe('sent');
		});

		it('sets sendState to failed', () => {
			addMessage('#test', makeMessage({ msgid: 'send-2' }));
			updateSendState('#test', 'send-2', 'failed');
			expect(getMessage('#test', 'send-2')!.sendState).toBe('failed');
		});

		it('does nothing for unknown msgid', () => {
			addMessage('#test', makeMessage({ msgid: 'send-3' }));
			updateSendState('#test', 'unknown', 'failed');
			expect(getMessage('#test', 'send-3')!.sendState).toBeUndefined();
		});

		it('does nothing for unknown channel', () => {
			updateSendState('#nope', 'send-1', 'failed');
			// No error thrown
		});
	});

	describe('updateMessageText', () => {
		it('updates the text of an existing message in-place', () => {
			addMessage('#test', makeMessage({ msgid: 'ORIG1', text: 'Hello wrold' }));
			const updated = updateMessageText('#test', 'ORIG1', 'Hello world', 'EDIT1');
			expect(updated).toBe(true);
			const msg = getMessage('#test', 'ORIG1');
			expect(msg).not.toBeNull();
			expect(msg!.text).toBe('Hello world');
		});

		it('marks the message as edited', () => {
			addMessage('#test', makeMessage({ msgid: 'ORIG2', text: 'typo' }));
			updateMessageText('#test', 'ORIG2', 'fixed', 'EDIT2');
			const msg = getMessage('#test', 'ORIG2');
			expect(msg!.isEdited).toBe(true);
		});

		it('returns false for unknown msgid', () => {
			const result = updateMessageText('#test', 'nonexistent', 'text', 'EDIT3');
			expect(result).toBe(false);
		});

		it('returns false for unknown channel', () => {
			const result = updateMessageText('#nope', 'ORIG1', 'text', 'EDIT3');
			expect(result).toBe(false);
		});

		it('preserves message position in the buffer', () => {
			addMessage('#test', makeMessage({ msgid: 'a', text: 'first' }));
			addMessage('#test', makeMessage({ msgid: 'b', text: 'second' }));
			addMessage('#test', makeMessage({ msgid: 'c', text: 'third' }));
			updateMessageText('#test', 'b', 'edited second', 'EDIT_B');
			const msgs = getMessages('#test');
			expect(msgs[1].msgid).toBe('b');
			expect(msgs[1].text).toBe('edited second');
		});
	});

	describe('edit history', () => {
		it('preserves original text in editHistory on first edit', () => {
			addMessage('#test', makeMessage({ msgid: 'EH1', text: 'original text' }));
			updateMessageText('#test', 'EH1', 'edited text', 'EDIT_EH1');
			const msg = getMessage('#test', 'EH1')!;
			expect(msg.editHistory).toEqual(['original text']);
			expect(msg.text).toBe('edited text');
		});

		it('accumulates multiple edits in editHistory', () => {
			addMessage('#test', makeMessage({ msgid: 'EH2', text: 'v1' }));
			updateMessageText('#test', 'EH2', 'v2', 'EDIT_EH2a');
			updateMessageText('#test', 'EH2', 'v3', 'EDIT_EH2b');
			updateMessageText('#test', 'EH2', 'v4', 'EDIT_EH2c');
			const msg = getMessage('#test', 'EH2')!;
			expect(msg.editHistory).toEqual(['v1', 'v2', 'v3']);
			expect(msg.text).toBe('v4');
		});

		it('editHistory is undefined for messages that were never edited', () => {
			addMessage('#test', makeMessage({ msgid: 'EH3', text: 'no edits' }));
			const msg = getMessage('#test', 'EH3')!;
			expect(msg.editHistory).toBeUndefined();
		});

		it('editHistory is initialized as empty array then populated on first edit', () => {
			addMessage('#test', makeMessage({ msgid: 'EH4', text: 'start' }));
			expect(getMessage('#test', 'EH4')!.editHistory).toBeUndefined();
			updateMessageText('#test', 'EH4', 'after edit', 'EDIT_EH4');
			const msg = getMessage('#test', 'EH4')!;
			expect(Array.isArray(msg.editHistory)).toBe(true);
			expect(msg.editHistory).toHaveLength(1);
		});

		it('editHistory preserves each intermediate version in order', () => {
			addMessage('#test', makeMessage({ msgid: 'EH5', text: 'alpha' }));
			updateMessageText('#test', 'EH5', 'beta', 'EDIT_EH5a');
			updateMessageText('#test', 'EH5', 'gamma', 'EDIT_EH5b');
			const msg = getMessage('#test', 'EH5')!;
			// History should contain all previous values in chronological order
			expect(msg.editHistory![0]).toBe('alpha');
			expect(msg.editHistory![1]).toBe('beta');
			expect(msg.text).toBe('gamma');
		});

		it('returns false and does not create editHistory for unknown message', () => {
			const result = updateMessageText('#test', 'nonexistent', 'text', 'EDIT_NONE');
			expect(result).toBe(false);
			// No message to check — just verify no error thrown
		});
	});

	describe('resolveEditChain', () => {
		it('stores edit mapping and resolves original->new msgid', () => {
			addMessage('#test', makeMessage({ msgid: 'ORIG1', text: 'original' }));
			updateMessageText('#test', 'ORIG1', 'edited', 'EDIT1');
			expect(resolveEditChain('ORIG1')).toBe('EDIT1');
		});

		it('follows multi-step edit chains', () => {
			addMessage('#test', makeMessage({ msgid: 'ORIG1', text: 'v1' }));
			updateMessageText('#test', 'ORIG1', 'v2', 'EDIT1');
			updateMessageText('#test', 'ORIG1', 'v3', 'EDIT2');
			// The chain should resolve ORIG1 to the latest edit msgid
			expect(resolveEditChain('ORIG1')).toBe('EDIT2');
		});

		it('returns the same msgid if no edit chain exists', () => {
			expect(resolveEditChain('NOMATCH')).toBe('NOMATCH');
		});

		it('allows getMessage to find by original msgid after edit', () => {
			addMessage('#test', makeMessage({ msgid: 'ORIG1', text: 'original' }));
			updateMessageText('#test', 'ORIG1', 'edited', 'EDIT1');
			// getMessage should still find by original msgid
			const msg = getMessage('#test', 'ORIG1');
			expect(msg).not.toBeNull();
			expect(msg!.text).toBe('edited');
		});
	});

	describe('pinned messages', () => {
		it('pins a message by msgid for a channel', () => {
			pinMessage('#test', 'msg-1');
			expect(isPinned('#test', 'msg-1')).toBe(true);
		});

		it('returns pinned message ids for a channel', () => {
			pinMessage('#test', 'msg-1');
			pinMessage('#test', 'msg-2');
			const pinned = getPinnedMessages('#test');
			expect(pinned.has('msg-1')).toBe(true);
			expect(pinned.has('msg-2')).toBe(true);
			expect(pinned.size).toBe(2);
		});

		it('unpins a message', () => {
			pinMessage('#test', 'msg-1');
			expect(isPinned('#test', 'msg-1')).toBe(true);
			unpinMessage('#test', 'msg-1');
			expect(isPinned('#test', 'msg-1')).toBe(false);
		});

		it('returns empty set for channel with no pins', () => {
			const pinned = getPinnedMessages('#empty');
			expect(pinned.size).toBe(0);
		});

		it('tracks pins per channel independently', () => {
			pinMessage('#a', 'msg-1');
			pinMessage('#b', 'msg-2');
			expect(isPinned('#a', 'msg-1')).toBe(true);
			expect(isPinned('#a', 'msg-2')).toBe(false);
			expect(isPinned('#b', 'msg-2')).toBe(true);
			expect(isPinned('#b', 'msg-1')).toBe(false);
		});

		it('is idempotent — pinning twice does not duplicate', () => {
			pinMessage('#test', 'msg-1');
			pinMessage('#test', 'msg-1');
			expect(getPinnedMessages('#test').size).toBe(1);
		});

		it('unpinning a non-pinned message is a no-op', () => {
			unpinMessage('#test', 'msg-1');
			expect(isPinned('#test', 'msg-1')).toBe(false);
		});

		it('resetMessages clears pinned messages', () => {
			pinMessage('#test', 'msg-1');
			resetMessages();
			expect(isPinned('#test', 'msg-1')).toBe(false);
		});
	});

	describe('replaceOptimisticMessage', () => {
		it('replaces a local optimistic message with the server echo', () => {
			const optimistic = makeMessage({ msgid: '_local_1', nick: 'alice', text: 'hello' });
			addMessage('#test', optimistic);
			expect(getMessages('#test')).toHaveLength(1);
			expect(getMessages('#test')[0].msgid).toBe('_local_1');

			const echoMsg = makeMessage({ msgid: 'server-123', nick: 'alice', text: 'hello' });
			const replaced = replaceOptimisticMessage('#test', echoMsg);
			expect(replaced).toBe(true);
			expect(getMessages('#test')).toHaveLength(1);
			expect(getMessages('#test')[0].msgid).toBe('server-123');
		});

		it('returns false when no matching optimistic message exists', () => {
			addMessage('#test', makeMessage({ msgid: 'server-1', nick: 'alice', text: 'hello' }));
			const echoMsg = makeMessage({ msgid: 'server-2', nick: 'alice', text: 'hello' });
			const replaced = replaceOptimisticMessage('#test', echoMsg);
			expect(replaced).toBe(false);
		});

		it('returns false for unknown channel', () => {
			const echoMsg = makeMessage({ msgid: 'server-1', nick: 'alice', text: 'hello' });
			const replaced = replaceOptimisticMessage('#nope', echoMsg);
			expect(replaced).toBe(false);
		});

		it('only matches messages with same nick and text', () => {
			addMessage('#test', makeMessage({ msgid: '_local_1', nick: 'alice', text: 'hello' }));
			// Different text
			const echoMsg = makeMessage({ msgid: 'server-1', nick: 'alice', text: 'different' });
			const replaced = replaceOptimisticMessage('#test', echoMsg);
			expect(replaced).toBe(false);
			// Original still present
			expect(getMessages('#test')[0].msgid).toBe('_local_1');
		});

		it('replaces the oldest matching optimistic message', () => {
			addMessage('#test', makeMessage({ msgid: '_local_1', nick: 'alice', text: 'hello' }));
			addMessage('#test', makeMessage({ msgid: '_local_2', nick: 'alice', text: 'hello' }));
			const echoMsg = makeMessage({ msgid: 'server-1', nick: 'alice', text: 'hello' });
			replaceOptimisticMessage('#test', echoMsg);
			const msgs = getMessages('#test');
			expect(msgs[0].msgid).toBe('server-1');
			expect(msgs[1].msgid).toBe('_local_2');
		});

		it('updates cursors after replacement', () => {
			addMessage('#test', makeMessage({ msgid: '_local_1', nick: 'alice', text: 'hello' }));
			const echoMsg = makeMessage({ msgid: 'server-1', nick: 'alice', text: 'hello' });
			replaceOptimisticMessage('#test', echoMsg);
			const c = getCursors('#test');
			expect(c.newestMsgid).toBe('server-1');
		});
	});

	describe('appendMessages', () => {
		it('appends messages to the end of the buffer', () => {
			addMessage('#test', makeMessage({ msgid: 'existing-1' }));
			appendMessages('#test', [
				makeMessage({ msgid: 'new-1' }),
				makeMessage({ msgid: 'new-2' }),
			]);
			const ids = getMessages('#test').map((m) => m.msgid);
			expect(ids).toEqual(['existing-1', 'new-1', 'new-2']);
		});

		it('evicts oldest messages when exceeding capacity', () => {
			for (let i = 0; i < 498; i++) {
				addMessage('#test', makeMessage({ msgid: `existing-${i}` }));
			}
			appendMessages('#test', [
				makeMessage({ msgid: 'append-0' }),
				makeMessage({ msgid: 'append-1' }),
				makeMessage({ msgid: 'append-2' }),
				makeMessage({ msgid: 'append-3' }),
				makeMessage({ msgid: 'append-4' }),
			]);
			const msgs = getMessages('#test');
			expect(msgs).toHaveLength(500);
			// Oldest 3 existing should be evicted (498 + 5 = 503 -> trim 3 from start)
			expect(msgs[0].msgid).toBe('existing-3');
			// Appended messages at the end
			expect(msgs[msgs.length - 1].msgid).toBe('append-4');
			expect(msgs[msgs.length - 5].msgid).toBe('append-0');
		});

		it('creates the channel buffer if it does not exist', () => {
			appendMessages('#new', [makeMessage({ msgid: 'a1', target: '#new' })]);
			expect(getMessages('#new')).toHaveLength(1);
			expect(getMessages('#new')[0].msgid).toBe('a1');
		});

		it('updates cursors after append', () => {
			addMessage('#test', makeMessage({ msgid: 'first' }));
			appendMessages('#test', [makeMessage({ msgid: 'last' })]);
			const c = getCursors('#test');
			expect(c.oldestMsgid).toBe('first');
			expect(c.newestMsgid).toBe('last');
		});
	});

	describe('searchMessages', () => {
		it('finds messages by text content', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'hello world' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'goodbye world' }));
			addMessage('#test', makeMessage({ msgid: 's3', text: 'hello there' }));
			const results = searchMessages('#test', 'hello');
			expect(results).toHaveLength(2);
			expect(results.map((m) => m.msgid)).toEqual(['s1', 's3']);
		});

		it('search is case-insensitive', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'Hello World' }));
			const results = searchMessages('#test', 'hello');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('returns empty array for no matches', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'hello' }));
			const results = searchMessages('#test', 'xyz');
			expect(results).toHaveLength(0);
		});

		it('returns empty array for empty query', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'hello' }));
			const results = searchMessages('#test', '');
			expect(results).toHaveLength(0);
		});

		it('filters by from:username', () => {
			addMessage('#test', makeMessage({ msgid: 's1', nick: 'alice', text: 'hello' }));
			addMessage('#test', makeMessage({ msgid: 's2', nick: 'bob', text: 'hello' }));
			addMessage('#test', makeMessage({ msgid: 's3', nick: 'alice', text: 'world' }));
			const results = searchMessages('#test', 'from:alice');
			expect(results).toHaveLength(2);
			expect(results.map((m) => m.msgid)).toEqual(['s1', 's3']);
		});

		it('combines from: filter with text search', () => {
			addMessage('#test', makeMessage({ msgid: 's1', nick: 'alice', text: 'hello world' }));
			addMessage('#test', makeMessage({ msgid: 's2', nick: 'bob', text: 'hello world' }));
			addMessage('#test', makeMessage({ msgid: 's3', nick: 'alice', text: 'goodbye' }));
			const results = searchMessages('#test', 'from:alice hello');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('searches across channels with in:#channel filter', () => {
			addMessage('#general', makeMessage({ msgid: 's1', target: '#general', text: 'hello from general' }));
			addMessage('#random', makeMessage({ msgid: 's2', target: '#random', text: 'hello from random' }));
			addMessage('#test', makeMessage({ msgid: 's3', target: '#test', text: 'hello from test' }));
			// Search in #general while providing any channel as the default
			const results = searchMessages('#test', 'in:#general hello');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('excludes redacted messages', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'hello' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'hello', isRedacted: true }));
			const results = searchMessages('#test', 'hello');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('only searches privmsg type messages', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'alice joined', type: 'join' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'hello', type: 'privmsg' }));
			const results = searchMessages('#test', 'alice');
			expect(results).toHaveLength(0);
		});

		it('from: filter is case-insensitive', () => {
			addMessage('#test', makeMessage({ msgid: 's1', nick: 'Alice', text: 'hello' }));
			const results = searchMessages('#test', 'from:alice');
			expect(results).toHaveLength(1);
		});

		it('filters by has:image for jpg URLs', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'check this https://example.com/photo.jpg' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'no image here' }));
			const results = searchMessages('#test', 'has:image');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('filters by has:image for png and webp URLs', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'https://cdn.example.com/a.png' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'https://cdn.example.com/b.webp' }));
			addMessage('#test', makeMessage({ msgid: 's3', text: 'https://cdn.example.com/c.pdf' }));
			const results = searchMessages('#test', 'has:image');
			expect(results).toHaveLength(2);
			expect(results.map((m) => m.msgid)).toEqual(['s1', 's2']);
		});

		it('has:image matches gif URLs with query strings', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'https://example.com/anim.gif?v=2' }));
			const results = searchMessages('#test', 'has:image');
			expect(results).toHaveLength(1);
		});

		it('has:image does not match non-image URLs', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'https://example.com/file.txt' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'just some text with .jpg in it' }));
			const results = searchMessages('#test', 'has:image');
			expect(results).toHaveLength(0);
		});

		it('filters by has:link for URLs', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'visit https://example.com' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'no link here' }));
			addMessage('#test', makeMessage({ msgid: 's3', text: 'try http://old.example.com/page' }));
			const results = searchMessages('#test', 'has:link');
			expect(results).toHaveLength(2);
			expect(results.map((m) => m.msgid)).toEqual(['s1', 's3']);
		});

		it('has:link does not match text without URLs', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'example.com is a domain' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'ftp://not-http.example.com' }));
			const results = searchMessages('#test', 'has:link');
			expect(results).toHaveLength(0);
		});

		it('filters by before:date', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'old', time: new Date('2025-01-10') }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'new', time: new Date('2025-03-15') }));
			const results = searchMessages('#test', 'before:2025-02-01');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('filters by after:date', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'old', time: new Date('2025-01-10') }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'new', time: new Date('2025-03-15') }));
			const results = searchMessages('#test', 'after:2025-02-01');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s2');
		});

		it('before: and after: can be combined for date range', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'jan', time: new Date('2025-01-15') }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'feb', time: new Date('2025-02-15') }));
			addMessage('#test', makeMessage({ msgid: 's3', text: 'apr', time: new Date('2025-04-15') }));
			const results = searchMessages('#test', 'after:2025-01-31 before:2025-03-01');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s2');
		});

		it('ignores invalid before: date value', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'hello' }));
			const results = searchMessages('#test', 'before:not-a-date hello');
			// Invalid date is ignored, text search still works
			expect(results).toHaveLength(1);
		});

		it('combines has:link with from: filter', () => {
			addMessage('#test', makeMessage({ msgid: 's1', nick: 'alice', text: 'https://example.com' }));
			addMessage('#test', makeMessage({ msgid: 's2', nick: 'bob', text: 'https://other.com' }));
			addMessage('#test', makeMessage({ msgid: 's3', nick: 'alice', text: 'no link' }));
			const results = searchMessages('#test', 'from:alice has:link');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});

		it('has:image combined with text search', () => {
			addMessage('#test', makeMessage({ msgid: 's1', text: 'sunset https://example.com/sunset.jpg' }));
			addMessage('#test', makeMessage({ msgid: 's2', text: 'cat https://example.com/cat.jpg' }));
			addMessage('#test', makeMessage({ msgid: 's3', text: 'sunset without image' }));
			const results = searchMessages('#test', 'has:image sunset');
			expect(results).toHaveLength(1);
			expect(results[0].msgid).toBe('s1');
		});
	});

	describe('threads', () => {
		describe('getThreadRoot', () => {
			it('returns the msgid itself when message has no replyTo', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root message' }));
				expect(getThreadRoot('#test', 'root-1')).toBe('root-1');
			});

			it('returns the parent msgid for a direct reply', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'reply', replyTo: 'root-1' }));
				expect(getThreadRoot('#test', 'reply-1')).toBe('root-1');
			});

			it('walks up a chain of replies to find the root', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'r1', replyTo: 'root-1' }));
				addMessage('#test', makeMessage({ msgid: 'reply-2', text: 'r2', replyTo: 'reply-1' }));
				addMessage('#test', makeMessage({ msgid: 'reply-3', text: 'r3', replyTo: 'reply-2' }));
				expect(getThreadRoot('#test', 'reply-3')).toBe('root-1');
			});

			it('returns msgid for unknown channel', () => {
				expect(getThreadRoot('#nope', 'any-id')).toBe('any-id');
			});

			it('returns msgid when parent is not in the buffer', () => {
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'orphan', replyTo: 'missing-parent' }));
				// Parent is not in buffer, so reply-1's replyTo walks to missing-parent
				// but missing-parent is not found, so it stops there
				expect(getThreadRoot('#test', 'reply-1')).toBe('missing-parent');
			});
		});

		describe('getThread', () => {
			it('returns the root message and its direct reply', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'reply', replyTo: 'root-1' }));
				const thread = getThread('#test', 'root-1');
				expect(thread).toHaveLength(2);
				expect(thread[0].msgid).toBe('root-1');
				expect(thread[1].msgid).toBe('reply-1');
			});

			it('collects a chain of nested replies under the root', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'r1', replyTo: 'root-1' }));
				addMessage('#test', makeMessage({ msgid: 'reply-2', text: 'r2', replyTo: 'reply-1' }));
				addMessage('#test', makeMessage({ msgid: 'reply-3', text: 'r3', replyTo: 'reply-2' }));
				const thread = getThread('#test', 'root-1');
				expect(thread).toHaveLength(4);
				expect(thread.map(m => m.msgid)).toEqual(['root-1', 'reply-1', 'reply-2', 'reply-3']);
			});

			it('groups multiple separate threads independently', () => {
				addMessage('#test', makeMessage({ msgid: 'rootA', text: 'thread A' }));
				addMessage('#test', makeMessage({ msgid: 'rootB', text: 'thread B' }));
				addMessage('#test', makeMessage({ msgid: 'replyA1', text: 'reply to A', replyTo: 'rootA' }));
				addMessage('#test', makeMessage({ msgid: 'replyB1', text: 'reply to B', replyTo: 'rootB' }));
				addMessage('#test', makeMessage({ msgid: 'replyA2', text: 'second reply to A', replyTo: 'rootA' }));

				const threadA = getThread('#test', 'rootA');
				expect(threadA).toHaveLength(3);
				expect(threadA.map(m => m.msgid)).toEqual(['rootA', 'replyA1', 'replyA2']);

				const threadB = getThread('#test', 'rootB');
				expect(threadB).toHaveLength(2);
				expect(threadB.map(m => m.msgid)).toEqual(['rootB', 'replyB1']);
			});

			it('returns only the root when there are no replies', () => {
				addMessage('#test', makeMessage({ msgid: 'lonely', text: 'no replies' }));
				const thread = getThread('#test', 'lonely');
				expect(thread).toHaveLength(1);
				expect(thread[0].msgid).toBe('lonely');
			});

			it('returns empty array for unknown channel', () => {
				expect(getThread('#nope', 'any-id')).toEqual([]);
			});

			it('returns empty array when root msgid does not exist in buffer', () => {
				addMessage('#test', makeMessage({ msgid: 'other', text: 'unrelated' }));
				const thread = getThread('#test', 'nonexistent');
				expect(thread).toHaveLength(0);
			});
		});

		describe('getThreadCount', () => {
			it('returns 0 for a message with no replies', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				expect(getThreadCount('#test', 'root-1')).toBe(0);
			});

			it('returns 1 for a single reply', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'reply', replyTo: 'root-1' }));
				expect(getThreadCount('#test', 'root-1')).toBe(1);
			});

			it('counts all replies in a nested chain', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'r1', text: 'r1', replyTo: 'root-1' }));
				addMessage('#test', makeMessage({ msgid: 'r2', text: 'r2', replyTo: 'r1' }));
				addMessage('#test', makeMessage({ msgid: 'r3', text: 'r3', replyTo: 'r2' }));
				expect(getThreadCount('#test', 'root-1')).toBe(3);
			});

			it('returns 0 for unknown channel', () => {
				expect(getThreadCount('#nope', 'any-id')).toBe(0);
			});
		});

		describe('hasThread', () => {
			it('returns true when a message has replies', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'reply', replyTo: 'root-1' }));
				expect(hasThread('#test', 'root-1')).toBe(true);
			});

			it('returns false when a message has no replies', () => {
				addMessage('#test', makeMessage({ msgid: 'lonely', text: 'no replies' }));
				expect(hasThread('#test', 'lonely')).toBe(false);
			});

			it('returns false for unknown channel', () => {
				expect(hasThread('#nope', 'any-id')).toBe(false);
			});
		});

		describe('threadId computation in addMessage', () => {
			it('sets threadId on a reply to the root message id', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'reply-1', text: 'reply', replyTo: 'root-1' }));
				const msg = getMessage('#test', 'reply-1');
				expect(msg!.threadId).toBe('root-1');
			});

			it('sets threadId to the ultimate root for nested replies', () => {
				addMessage('#test', makeMessage({ msgid: 'root-1', text: 'root' }));
				addMessage('#test', makeMessage({ msgid: 'r1', text: 'r1', replyTo: 'root-1' }));
				addMessage('#test', makeMessage({ msgid: 'r2', text: 'r2', replyTo: 'r1' }));
				const msg = getMessage('#test', 'r2');
				expect(msg!.threadId).toBe('root-1');
			});

			it('does not set threadId on messages without replyTo', () => {
				addMessage('#test', makeMessage({ msgid: 'standalone', text: 'no reply' }));
				const msg = getMessage('#test', 'standalone');
				expect(msg!.threadId).toBeUndefined();
			});
		});
	});
});
