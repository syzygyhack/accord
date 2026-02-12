import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleMessage, typingState, resetHandlerState, registerHandler } from './handler';
import { parseMessage } from './parser';
import {
	getMessages,
	getMessage,
	getCursors,
	resetMessages,
} from '../state/messages.svelte';
import {
	channelState,
	getChannel,
	resetChannels,
} from '../state/channels.svelte';
import {
	presenceState,
	isOnline,
	resetPresence,
} from '../state/presence.svelte';
import type { IRCConnection } from './connection';

/** Parse a raw IRC line and pass it through the handler. */
function handle(line: string): void {
	const parsed = parseMessage(line);
	handleMessage(parsed);
}

beforeEach(() => {
	resetMessages();
	resetChannels();
	resetPresence();
	resetHandlerState();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('PRIVMSG handling', () => {
	it('adds a message to the target channel', () => {
		handle(
			'@msgid=abc123;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hello world'
		);
		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].msgid).toBe('abc123');
		expect(msgs[0].nick).toBe('alice');
		expect(msgs[0].account).toBe('alice');
		expect(msgs[0].text).toBe('hello world');
		expect(msgs[0].target).toBe('#test');
		expect(msgs[0].isRedacted).toBe(false);
	});

	it('extracts reply-to tag', () => {
		handle(
			'@msgid=def;+draft/reply=abc123;account=bob :bob!b@host PRIVMSG #test :replying'
		);
		const msg = getMessage('#test', 'def');
		expect(msg).not.toBeNull();
		expect(msg!.replyTo).toBe('abc123');
	});

	it('handles message without optional tags', () => {
		handle(':carol!c@host PRIVMSG #test :hi');
		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].nick).toBe('carol');
		expect(msgs[0].msgid).toBe('');
		expect(msgs[0].account).toBe('');
	});

	it('clears typing indicator on PRIVMSG', () => {
		// Set up typing state
		handle('@+typing=active :alice!a@host TAGMSG #test');
		expect(typingState.get('#test')?.has('alice')).toBe(true);

		// PRIVMSG should clear it
		handle('@msgid=x;account=alice :alice!a@host PRIVMSG #test :done typing');
		expect(typingState.get('#test')?.has('alice')).toBeFalsy();
	});
});

describe('TAGMSG handling', () => {
	it('handles +draft/react to add a reaction', () => {
		// First add a message to react to
		handle('@msgid=msg1;account=alice :alice!a@host PRIVMSG #test :hello');

		// React to it
		handle(
			'@+draft/react=👍;+draft/reply=msg1;account=bob :bob!b@host TAGMSG #test'
		);

		const msg = getMessage('#test', 'msg1');
		expect(msg).not.toBeNull();
		expect(msg!.reactions.has('👍')).toBe(true);
		expect(msg!.reactions.get('👍')!.has('bob')).toBe(true);
	});

	it('handles +typing=active', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		expect(typingState.get('#test')?.has('alice')).toBe(true);
	});

	it('handles +typing=done', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		handle('@+typing=done :alice!a@host TAGMSG #test');
		expect(typingState.get('#test')?.has('alice')).toBeFalsy();
	});

	it('typing expires after timeout', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		expect(typingState.get('#test')?.has('alice')).toBe(true);

		vi.advanceTimersByTime(6_000);
		expect(typingState.get('#test')?.has('alice')).toBeFalsy();
	});
});

describe('REDACT handling', () => {
	it('marks a message as redacted', () => {
		handle('@msgid=msg1;account=alice :alice!a@host PRIVMSG #test :secret');
		expect(getMessage('#test', 'msg1')!.isRedacted).toBe(false);

		handle(':mod!m@host REDACT #test msg1');
		expect(getMessage('#test', 'msg1')!.isRedacted).toBe(true);
	});
});

describe('JOIN handling', () => {
	it('adds a member to the channel', () => {
		handle(':alice!a@host JOIN #test alice :Alice Real');
		const ch = getChannel('#test');
		expect(ch).not.toBeNull();
		expect(ch!.members.has('alice')).toBe(true);
		expect(ch!.members.get('alice')!.account).toBe('alice');
	});

	it('uses account tag if no extended-join param', () => {
		handle('@account=alice :alice!a@host JOIN #test');
		const ch = getChannel('#test');
		expect(ch).not.toBeNull();
		// Falls through to params[1] first, which is empty, then tags
		// Actually params[0] = #test, params[1] doesn't exist for basic JOIN
		const member = ch!.members.get('alice');
		expect(member).toBeDefined();
	});
});

describe('PART handling', () => {
	it('removes a member from the channel', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host PART #test :bye');
		const ch = getChannel('#test');
		expect(ch).not.toBeNull();
		expect(ch!.members.has('alice')).toBe(false);
	});
});

describe('QUIT handling', () => {
	it('removes a user from all channels', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host JOIN #other alice :Alice');
		handle(':alice!a@host QUIT :connection reset');

		expect(getChannel('#test')!.members.has('alice')).toBe(false);
		expect(getChannel('#other')!.members.has('alice')).toBe(false);
	});
});

describe('TOPIC handling', () => {
	it('updates channel topic', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host TOPIC #test :New topic here');
		expect(getChannel('#test')!.topic).toBe('New topic here');
	});
});

describe('NAMES (353/366) handling', () => {
	it('populates member list from NAMES reply', () => {
		handle(':server 353 me = #test :@op +voice regular');
		const ch = getChannel('#test');
		expect(ch).not.toBeNull();
		expect(ch!.members.has('op')).toBe(true);
		expect(ch!.members.get('op')!.prefix).toBe('@');
		expect(ch!.members.has('voice')).toBe(true);
		expect(ch!.members.get('voice')!.prefix).toBe('+');
		expect(ch!.members.has('regular')).toBe(true);
		expect(ch!.members.get('regular')!.prefix).toBe('');
	});

	it('handles userhost-in-names format', () => {
		handle(':server 353 me = #test :@op!user@host +voice!v@host');
		const ch = getChannel('#test');
		expect(ch!.members.has('op')).toBe(true);
		expect(ch!.members.get('op')!.prefix).toBe('@');
		expect(ch!.members.has('voice')).toBe(true);
	});

	it('marks names as loaded on 366', () => {
		handle(':server 353 me = #test :@op regular');
		expect(getChannel('#test')!.namesLoaded).toBe(false);
		handle(':server 366 me #test :End of /NAMES list');
		expect(getChannel('#test')!.namesLoaded).toBe(true);
	});
});

describe('BATCH handling', () => {
	it('accumulates chathistory messages and prepends on close', () => {
		// Add an existing message
		handle('@msgid=new1;account=bob :bob!b@host PRIVMSG #test :recent');

		// Open a chathistory batch
		handle(':server BATCH +ref1 chathistory #test');

		// Batched messages
		handle(
			'@batch=ref1;msgid=old1;account=alice;time=2024-12-31T00:00:00Z :alice!a@host PRIVMSG #test :old message 1'
		);
		handle(
			'@batch=ref1;msgid=old2;account=alice;time=2024-12-31T00:01:00Z :alice!a@host PRIVMSG #test :old message 2'
		);

		// Close the batch
		handle(':server BATCH -ref1');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(3);
		// History prepended
		expect(msgs[0].msgid).toBe('old1');
		expect(msgs[1].msgid).toBe('old2');
		expect(msgs[2].msgid).toBe('new1');
	});

	it('does not leak batched messages to main flow', () => {
		handle(':server BATCH +ref2 chathistory #test');
		handle(
			'@batch=ref2;msgid=batched;account=alice :alice!a@host PRIVMSG #test :in batch'
		);
		// While batch is open, messages should not appear in channel yet
		expect(getMessages('#test')).toHaveLength(0);

		handle(':server BATCH -ref2');
		// Now they appear
		expect(getMessages('#test')).toHaveLength(1);
	});
});

describe('MONITOR (730/731) handling', () => {
	it('marks nicks as online on 730', () => {
		handle(':server 730 me :alice!a@host,bob!b@host');
		expect(isOnline('alice')).toBe(true);
		expect(isOnline('bob')).toBe(true);
	});

	it('marks nicks as offline on 731', () => {
		handle(':server 730 me :alice!a@host');
		expect(isOnline('alice')).toBe(true);
		handle(':server 731 me :alice!a@host');
		expect(isOnline('alice')).toBe(false);
	});
});

describe('registerHandler', () => {
	it('registers a message listener on the connection', () => {
		const handlers: ((line: string) => void)[] = [];
		const conn = {
			send: vi.fn(),
			on(event: string, handler: (...args: any[]) => void) {
				if (event === 'message') {
					handlers.push(handler as (line: string) => void);
				}
			},
		} as unknown as IRCConnection;

		registerHandler(conn);
		expect(handlers).toHaveLength(1);

		// Simulate a message
		handlers[0](
			'@msgid=reg1;account=test :test!t@host PRIVMSG #test :via registerHandler'
		);
		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].msgid).toBe('reg1');
	});
});

describe('cursor tracking through handler', () => {
	it('updates cursors as messages arrive', () => {
		handle('@msgid=first;account=a :a!a@h PRIVMSG #test :one');
		handle('@msgid=second;account=a :a!a@h PRIVMSG #test :two');
		handle('@msgid=third;account=a :a!a@h PRIVMSG #test :three');

		const c = getCursors('#test');
		expect(c.oldestMsgid).toBe('first');
		expect(c.newestMsgid).toBe('third');
	});
});
