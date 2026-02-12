import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	typingState,
	setTyping,
	clearTyping,
	getTypingUsers,
	resetTyping,
} from './typing.svelte';

describe('typing state', () => {
	beforeEach(() => {
		resetTyping();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('setTyping', () => {
		it('adds a typing user to a channel', () => {
			setTyping('#test', 'alice');
			expect(typingState.channels.has('#test')).toBe(true);
			expect(typingState.channels.get('#test')!.has('alice')).toBe(true);
		});

		it('creates the channel map if it does not exist', () => {
			expect(typingState.channels.has('#new')).toBe(false);
			setTyping('#new', 'bob');
			expect(typingState.channels.has('#new')).toBe(true);
		});

		it('updates the timestamp on repeated calls', () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
			setTyping('#test', 'alice');
			const t1 = typingState.channels.get('#test')!.get('alice')!;

			vi.setSystemTime(new Date('2025-01-01T00:00:02Z'));
			setTyping('#test', 'alice');
			const t2 = typingState.channels.get('#test')!.get('alice')!;

			expect(t2).toBeGreaterThan(t1);
		});

		it('tracks multiple users per channel', () => {
			setTyping('#test', 'alice');
			setTyping('#test', 'bob');
			expect(typingState.channels.get('#test')!.size).toBe(2);
		});
	});

	describe('clearTyping', () => {
		it('removes a typing user from a channel', () => {
			setTyping('#test', 'alice');
			setTyping('#test', 'bob');
			clearTyping('#test', 'alice');
			expect(typingState.channels.get('#test')!.has('alice')).toBe(false);
			expect(typingState.channels.get('#test')!.has('bob')).toBe(true);
		});

		it('removes the channel map when last user is cleared', () => {
			setTyping('#test', 'alice');
			clearTyping('#test', 'alice');
			expect(typingState.channels.has('#test')).toBe(false);
		});

		it('does nothing for unknown channel', () => {
			clearTyping('#nope', 'alice');
			// No error thrown
		});

		it('does nothing for unknown nick', () => {
			setTyping('#test', 'alice');
			clearTyping('#test', 'bob');
			expect(typingState.channels.get('#test')!.has('alice')).toBe(true);
		});
	});

	describe('getTypingUsers', () => {
		it('returns empty array for unknown channel', () => {
			expect(getTypingUsers('#unknown')).toEqual([]);
		});

		it('returns active typing users', () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
			setTyping('#test', 'alice');
			setTyping('#test', 'bob');
			const users = getTypingUsers('#test');
			expect(users).toContain('alice');
			expect(users).toContain('bob');
			expect(users).toHaveLength(2);
		});

		it('filters out expired typing users (>6 seconds)', () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
			setTyping('#test', 'alice');

			vi.setSystemTime(new Date('2025-01-01T00:00:03Z'));
			setTyping('#test', 'bob');

			// Advance to 7 seconds after alice started — alice expired, bob still active
			vi.setSystemTime(new Date('2025-01-01T00:00:07Z'));
			const users = getTypingUsers('#test');
			expect(users).toEqual(['bob']);
		});

		it('cleans up channel map when all users expire', () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
			setTyping('#test', 'alice');

			vi.setSystemTime(new Date('2025-01-01T00:00:07Z'));
			const users = getTypingUsers('#test');
			expect(users).toEqual([]);
			expect(typingState.channels.has('#test')).toBe(false);
		});
	});

	describe('resetTyping', () => {
		it('clears all typing state', () => {
			setTyping('#a', 'alice');
			setTyping('#b', 'bob');
			resetTyping();
			expect(typingState.channels.size).toBe(0);
		});
	});
});
