/**
 * Tests for IndexedDB message cache serialization and deserialization.
 *
 * IndexedDB itself is not available in the Node.js test environment,
 * so we test the serialization layer and ensure the module degrades
 * gracefully when IndexedDB is unavailable.
 */

import { describe, test, expect } from 'vitest';
import { serializeMessage, deserializeMessage } from './messageCache';
import type { CachedMessage } from './messageCache';

describe('serializeMessage', () => {
	test('converts a Message to CachedMessage', () => {
		const reactions = new Map<string, Set<string>>();
		reactions.set('thumbsup', new Set(['alice', 'bob']));
		reactions.set('heart', new Set(['carol']));

		const msg = {
			msgid: 'abc123',
			nick: 'alice',
			account: 'alice',
			target: '#general',
			text: 'Hello world',
			time: new Date('2026-02-25T12:00:00Z'),
			tags: { 'account': 'alice' },
			replyTo: undefined,
			threadId: undefined,
			reactions,
			isRedacted: false,
			isEdited: false,
			editHistory: undefined,
			type: 'privmsg' as const,
		};

		const cached = serializeMessage(msg, '#general');

		expect(cached.msgid).toBe('abc123');
		expect(cached.nick).toBe('alice');
		expect(cached.target).toBe('#general');
		expect(cached.channel).toBe('#general');
		expect(cached.time).toBe('2026-02-25T12:00:00.000Z');
		expect(cached.reactions).toEqual({
			thumbsup: ['alice', 'bob'],
			heart: ['carol'],
		});
		expect(cached.isRedacted).toBe(false);
	});

	test('preserves edit history', () => {
		const msg = {
			msgid: 'def456',
			nick: 'bob',
			account: 'bob',
			target: '#dev',
			text: 'Updated text',
			time: new Date('2026-02-25T13:00:00Z'),
			tags: {},
			reactions: new Map(),
			isRedacted: false,
			isEdited: true,
			editHistory: ['Original text', 'First edit'],
			type: 'privmsg' as const,
		};

		const cached = serializeMessage(msg, '#dev');
		expect(cached.isEdited).toBe(true);
		expect(cached.editHistory).toEqual(['Original text', 'First edit']);
	});

	test('preserves reply and thread info', () => {
		const msg = {
			msgid: 'ghi789',
			nick: 'carol',
			account: 'carol',
			target: '#general',
			text: 'Reply',
			time: new Date('2026-02-25T14:00:00Z'),
			tags: {},
			replyTo: 'abc123',
			threadId: 'abc123',
			reactions: new Map(),
			isRedacted: false,
			type: 'privmsg' as const,
		};

		const cached = serializeMessage(msg, '#general');
		expect(cached.replyTo).toBe('abc123');
		expect(cached.threadId).toBe('abc123');
	});
});

describe('deserializeMessage', () => {
	test('converts CachedMessage back to Message shape', () => {
		const cached: CachedMessage = {
			msgid: 'abc123',
			nick: 'alice',
			account: 'alice',
			target: '#general',
			text: 'Hello world',
			time: '2026-02-25T12:00:00.000Z',
			tags: { account: 'alice' },
			reactions: {
				thumbsup: ['alice', 'bob'],
				heart: ['carol'],
			},
			isRedacted: false,
			isEdited: false,
			type: 'privmsg',
			channel: '#general',
		};

		const msg = deserializeMessage(cached);

		expect(msg.msgid).toBe('abc123');
		expect(msg.nick).toBe('alice');
		expect(msg.time).toBeInstanceOf(Date);
		expect(msg.time.toISOString()).toBe('2026-02-25T12:00:00.000Z');
		expect(msg.reactions).toBeInstanceOf(Map);
		expect(msg.reactions.size).toBe(2);
		expect(msg.reactions.get('thumbsup')).toBeInstanceOf(Set);
		expect([...msg.reactions.get('thumbsup')!]).toEqual(['alice', 'bob']);
		expect([...msg.reactions.get('heart')!]).toEqual(['carol']);
	});

	test('handles empty reactions', () => {
		const cached: CachedMessage = {
			msgid: 'def456',
			nick: 'bob',
			account: 'bob',
			target: '#dev',
			text: 'No reactions',
			time: '2026-02-25T13:00:00.000Z',
			tags: {},
			reactions: {},
			isRedacted: false,
			type: 'privmsg',
			channel: '#dev',
		};

		const msg = deserializeMessage(cached);
		expect(msg.reactions.size).toBe(0);
	});

	test('preserves edit history through round-trip', () => {
		const cached: CachedMessage = {
			msgid: 'ghi789',
			nick: 'carol',
			account: 'carol',
			target: '#general',
			text: 'Final version',
			time: '2026-02-25T14:00:00.000Z',
			tags: {},
			reactions: {},
			isRedacted: false,
			isEdited: true,
			editHistory: ['Original', 'Second draft'],
			type: 'privmsg',
			channel: '#general',
		};

		const msg = deserializeMessage(cached);
		expect(msg.isEdited).toBe(true);
		expect(msg.editHistory).toEqual(['Original', 'Second draft']);
	});
});

describe('round-trip', () => {
	test('serialize then deserialize preserves all data', () => {
		const reactions = new Map<string, Set<string>>();
		reactions.set('fire', new Set(['alice']));

		const original = {
			msgid: 'round-trip-1',
			nick: 'alice',
			account: 'alice',
			target: '#general',
			text: 'Round trip test',
			time: new Date('2026-02-25T15:00:00Z'),
			tags: { 'draft/reply': 'parent-msg-id' },
			replyTo: 'parent-msg-id',
			threadId: 'parent-msg-id',
			reactions,
			isRedacted: false,
			isEdited: true,
			editHistory: ['Was: initial version'],
			type: 'privmsg' as const,
		};

		const cached = serializeMessage(original, '#general');
		const restored = deserializeMessage(cached);

		expect(restored.msgid).toBe(original.msgid);
		expect(restored.nick).toBe(original.nick);
		expect(restored.account).toBe(original.account);
		expect(restored.target).toBe(original.target);
		expect(restored.text).toBe(original.text);
		expect(restored.time.getTime()).toBe(original.time.getTime());
		expect(restored.replyTo).toBe(original.replyTo);
		expect(restored.threadId).toBe(original.threadId);
		expect(restored.isRedacted).toBe(original.isRedacted);
		expect(restored.isEdited).toBe(original.isEdited);
		expect(restored.editHistory).toEqual(original.editHistory);
		expect([...restored.reactions.get('fire')!]).toEqual(['alice']);
	});
});

describe('eviction ordering', () => {
	test('ISO 8601 time strings sort chronologically via localeCompare', () => {
		// The eviction logic sorts by time.localeCompare(time) to find oldest.
		// Verify ISO 8601 strings maintain chronological order when sorted this way.
		const times = [
			'2026-02-25T15:00:00.000Z', // newest
			'2026-02-25T12:00:00.000Z', // oldest
			'2026-02-25T14:00:00.000Z',
			'2026-02-25T13:00:00.000Z',
		];
		const sorted = [...times].sort((a, b) => a.localeCompare(b));
		expect(sorted).toEqual([
			'2026-02-25T12:00:00.000Z',
			'2026-02-25T13:00:00.000Z',
			'2026-02-25T14:00:00.000Z',
			'2026-02-25T15:00:00.000Z',
		]);
	});

	test('eviction would keep newest messages based on time sort', () => {
		// Simulate the eviction logic: given messages with non-time-ordered msgids,
		// sorting by time should identify the correct oldest messages for deletion.
		const messages: CachedMessage[] = [
			{ msgid: 'zzz-newest', time: '2026-02-25T15:00:00.000Z' },
			{ msgid: 'aaa-oldest', time: '2026-02-25T12:00:00.000Z' },
			{ msgid: 'mmm-middle', time: '2026-02-25T14:00:00.000Z' },
		].map((m) => ({
			...m,
			nick: 'alice',
			account: 'alice',
			target: '#test',
			text: 'test',
			tags: {},
			reactions: {},
			isRedacted: false,
			type: 'privmsg',
			channel: '#test',
		}));

		// Sort ascending by time (oldest first) — same as eviction logic
		const sorted = [...messages].sort((a, b) => a.time.localeCompare(b.time));

		// If we needed to evict 1, we'd delete sorted[0] (oldest by time)
		expect(sorted[0].msgid).toBe('aaa-oldest');
		expect(sorted[0].time).toBe('2026-02-25T12:00:00.000Z');

		// NOT 'aaa-oldest' by alphabetical msgid ordering
		const byMsgid = [...messages].sort((a, b) => a.msgid.localeCompare(b.msgid));
		expect(byMsgid[0].msgid).toBe('aaa-oldest'); // coincidence in this case
		// But swap times to show the difference matters
		const swapped: CachedMessage[] = [
			{ ...messages[0], msgid: 'aaa-actually-newest', time: '2026-02-25T15:00:00.000Z' },
			{ ...messages[1], msgid: 'zzz-actually-oldest', time: '2026-02-25T12:00:00.000Z' },
		];
		const sortedByTime = [...swapped].sort((a, b) => a.time.localeCompare(b.time));
		const sortedByKey = [...swapped].sort((a, b) => a.msgid.localeCompare(b.msgid));
		// Time-based: oldest first is zzz-actually-oldest
		expect(sortedByTime[0].msgid).toBe('zzz-actually-oldest');
		// Key-based: first would be aaa-actually-newest (WRONG for eviction)
		expect(sortedByKey[0].msgid).toBe('aaa-actually-newest');
	});
});

describe('graceful degradation', () => {
	test('openDB rejects when indexedDB is unavailable', async () => {
		// The module checks typeof indexedDB. In Node test env, it's undefined.
		// cacheMessage, loadCachedMessages etc. should reject, but callers
		// handle this via .catch().
		const { loadCachedMessages } = await import('./messageCache');
		await expect(loadCachedMessages('#test')).rejects.toThrow('IndexedDB not available');
	});

	test('clearAllCachedMessages resolves when indexedDB is unavailable', async () => {
		const { clearAllCachedMessages } = await import('./messageCache');
		// Should resolve without error (no-op when IDB unavailable)
		await expect(clearAllCachedMessages()).resolves.toBeUndefined();
	});
});
