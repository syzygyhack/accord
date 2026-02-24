import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleMessage, resetHandlerState, registerHandler } from './handler';
import { parseMessage } from './parser';
import {
	getMessages,
	getMessage,
	getCursors,
	resetMessages,
	addMessage,
	type Message,
} from '../state/messages.svelte';
import {
	channelState,
	getChannel,
	resetChannels,
	setActiveChannel,
	setCategories,
	resetChannelUI,
	getActiveChannel,
	channelUIState,
} from '../state/channels.svelte';
import {
	presenceState,
	isOnline,
	resetPresence,
} from '../state/presence.svelte';
import {
	getMember,
	getMembers,
	resetMembers,
} from '../state/members.svelte';
import {
	typingState,
	resetTyping,
} from '../state/typing.svelte';
import {
	getLastReadMsgid,
	getUnreadCount,
	getMentionCount,
	resetNotifications,
} from '../state/notifications.svelte';
import { userState } from '../state/user.svelte';
import type { IRCConnection } from './connection';

/** Parse a raw IRC line and pass it through the handler. */
function handle(line: string): void {
	const parsed = parseMessage(line);
	handleMessage(parsed);
}

beforeEach(() => {
	resetMessages();
	resetChannels();
	resetChannelUI();
	resetPresence();
	resetMembers();
	resetTyping();
	resetNotifications();
	resetHandlerState();
	userState.nick = null;
	userState.account = null;
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
		expect(typingState.channels.get('#test')?.has('alice')).toBe(true);

		// PRIVMSG should clear it
		handle('@msgid=x;account=alice :alice!a@host PRIVMSG #test :done typing');
		expect(typingState.channels.get('#test')?.has('alice')).toBeFalsy();
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

	it('toggles reaction off when same account reacts again', () => {
		// Add a message
		handle('@msgid=msg2;account=alice :alice!a@host PRIVMSG #test :hi');

		// First reaction — adds
		handle('@+draft/react=❤️;+draft/reply=msg2;account=carol :carol!c@host TAGMSG #test');
		let msg = getMessage('#test', 'msg2');
		expect(msg!.reactions.get('❤️')!.has('carol')).toBe(true);

		// Same reaction from same account — removes (toggle)
		handle('@+draft/react=❤️;+draft/reply=msg2;account=carol :carol!c@host TAGMSG #test');
		msg = getMessage('#test', 'msg2');
		expect(msg!.reactions.has('❤️')).toBe(false);
	});

	it('handles +typing=active', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		expect(typingState.channels.get('#test')?.has('alice')).toBe(true);
	});

	it('handles +typing=done', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		handle('@+typing=done :alice!a@host TAGMSG #test');
		expect(typingState.channels.get('#test')?.has('alice')).toBeFalsy();
	});

	it('typing expires after timeout', () => {
		handle('@+typing=active :alice!a@host TAGMSG #test');
		expect(typingState.channels.get('#test')?.has('alice')).toBe(true);

		vi.advanceTimersByTime(6_000);
		expect(typingState.channels.get('#test')?.has('alice')).toBeFalsy();
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
		// params[1] is undefined for basic JOIN, falls through to tags['account']
		const member = ch!.members.get('alice');
		expect(member).toBeDefined();
		expect(member!.account).toBe('alice');
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

	it('clears topic when set to empty', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host TOPIC #test :Some topic');
		expect(getChannel('#test')!.topic).toBe('Some topic');
		handle(':alice!a@host TOPIC #test');
		expect(getChannel('#test')!.topic).toBe('');
	});
});

describe('RPL_TOPIC (332) handling', () => {
	it('sets channel topic on join via 332', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':server 332 me #test :Welcome to #test!');
		expect(getChannel('#test')!.topic).toBe('Welcome to #test!');
	});

	it('handles 332 with empty topic', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':server 332 me #test');
		expect(getChannel('#test')!.topic).toBe('');
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

describe('PING/PONG keepalive', () => {
	it('responds to server PING with PONG', () => {
		const handlers: ((line: string) => void)[] = [];
		const conn = {
			send: vi.fn(),
			on(event: string, handler: (...args: any[]) => void) {
				if (event === 'message') {
					handlers.push(handler as (line: string) => void);
				}
			},
			off: vi.fn(),
		} as unknown as IRCConnection;

		registerHandler(conn);
		expect(handlers).toHaveLength(1);

		// Server sends PING
		handlers[0]('PING :accord.local');
		expect(conn.send).toHaveBeenCalledWith('PONG :accord.local');
	});

	it('responds to PING with timestamp token', () => {
		const handlers: ((line: string) => void)[] = [];
		const conn = {
			send: vi.fn(),
			on(event: string, handler: (...args: any[]) => void) {
				if (event === 'message') {
					handlers.push(handler as (line: string) => void);
				}
			},
			off: vi.fn(),
		} as unknown as IRCConnection;

		registerHandler(conn);
		handlers[0]('PING :1234567890');
		expect(conn.send).toHaveBeenCalledWith('PONG :1234567890');
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

// -----------------------------------------------------------------------
// Member state (members.svelte.ts) integration via handler
// -----------------------------------------------------------------------

describe('NAMES (353) -> member state', () => {
	it('populates member state from NAMES with multi-prefix and userhost-in-names', () => {
		handle(':server 353 me = #test :@+op!user@host +voice!v@host regular!r@host');
		const op = getMember('#test', 'op');
		expect(op).not.toBeNull();
		expect(op!.modes).toEqual(['@', '+']);
		expect(op!.highestMode).toBe('@');

		const voice = getMember('#test', 'voice');
		expect(voice).not.toBeNull();
		expect(voice!.modes).toEqual(['+']);
		expect(voice!.highestMode).toBe('+');

		const reg = getMember('#test', 'regular');
		expect(reg).not.toBeNull();
		expect(reg!.modes).toEqual([]);
		expect(reg!.highestMode).toBeNull();
	});

	it('populates member state from simple NAMES', () => {
		handle(':server 353 me = #test :@op +voice regular');
		expect(getMember('#test', 'op')?.highestMode).toBe('@');
		expect(getMember('#test', 'voice')?.highestMode).toBe('+');
		expect(getMember('#test', 'regular')?.highestMode).toBeNull();
	});
});

describe('WHO (352/354) -> member state', () => {
	it('handles 352 WHO reply to set account and away status', () => {
		// First populate via NAMES so the member exists
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');

		// 352: server 352 me #channel user host server nick H/G[*][@+] :hopcount realname
		// H = here, G = gone (away)
		handle(':server 352 me #test auser ahost server alice H :0 Alice Real');
		const m = getMember('#test', 'alice');
		expect(m).not.toBeNull();
		expect(m!.account).toBe('');
		expect(m!.isAway).toBe(false);
	});

	it('handles 352 WHO reply with away status (G)', () => {
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server 352 me #test auser ahost server alice G :0 Alice');
		const m = getMember('#test', 'alice');
		expect(m!.isAway).toBe(true);
		expect(m!.presence).toBe('idle');
	});

	it('handles 354 WHOX reply with account field', () => {
		handle(':server 353 me = #test :@alice');
		handle(':server 366 me #test :End of /NAMES list');

		// 354: server 354 me <token> <user> <host> <nick> <flags> <account>
		// Token 152 is a common WHOX token for our format
		handle(':server 354 me 152 auser ahost alice H alice_acct');
		const m = getMember('#test', 'alice');
		expect(m).not.toBeNull();
		expect(m!.account).toBe('alice_acct');
		expect(m!.isAway).toBe(false);
	});

	it('handles 354 WHOX with 0 account (not logged in)', () => {
		handle(':server 353 me = #test :bob');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server 354 me 152 buser bhost bob H 0');
		const m = getMember('#test', 'bob');
		expect(m!.account).toBe('');
	});

	it('handles 354 WHOX with away flag', () => {
		handle(':server 353 me = #test :carol');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server 354 me 152 cuser chost carol G carol_acct');
		const m = getMember('#test', 'carol');
		expect(m!.isAway).toBe(true);
		expect(m!.presence).toBe('idle');
	});
});

describe('AWAY handling -> member state', () => {
	it('updates presence when user goes away', () => {
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':alice!a@host AWAY :Gone fishing');
		const m = getMember('#test', 'alice');
		expect(m!.isAway).toBe(true);
		expect(m!.awayReason).toBe('Gone fishing');
		expect(m!.presence).toBe('idle');
	});

	it('updates presence when user returns from away', () => {
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':alice!a@host AWAY :Gone fishing');
		handle(':alice!a@host AWAY');
		const m = getMember('#test', 'alice');
		expect(m!.isAway).toBe(false);
		expect(m!.awayReason).toBeNull();
		expect(m!.presence).toBe('online');
	});

	it('detects DND from [DND] prefix in AWAY reason', () => {
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':alice!a@host AWAY :[DND] Do not disturb');
		const m = getMember('#test', 'alice');
		expect(m!.presence).toBe('dnd');
		expect(m!.awayReason).toBe('[DND] Do not disturb');
	});
});

describe('JOIN (extended-join) -> member state', () => {
	it('adds member to member state on JOIN', () => {
		handle(':alice!a@host JOIN #test alice :Alice Real');
		const m = getMember('#test', 'alice');
		expect(m).not.toBeNull();
		expect(m!.nick).toBe('alice');
		expect(m!.account).toBe('alice');
		expect(m!.modes).toEqual([]);
		expect(m!.highestMode).toBeNull();
		expect(m!.presence).toBe('online');
	});

	it('uses account tag if no extended-join params', () => {
		handle('@account=bob :bob!b@host JOIN #test');
		const m = getMember('#test', 'bob');
		expect(m).not.toBeNull();
	});
});

describe('PART -> member state', () => {
	it('removes member from member state on PART', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		expect(getMember('#test', 'alice')).not.toBeNull();
		handle(':alice!a@host PART #test :bye');
		expect(getMember('#test', 'alice')).toBeNull();
	});
});

describe('QUIT -> member state', () => {
	it('removes member from all channels in member state on QUIT', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host JOIN #other alice :Alice');
		handle(':alice!a@host QUIT :connection reset');
		expect(getMember('#test', 'alice')).toBeNull();
		expect(getMember('#other', 'alice')).toBeNull();
	});
});

describe('NICK handling', () => {
	it('renames member in channel state', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host NICK bob');
		expect(getChannel('#test')?.members.has('bob')).toBe(true);
		expect(getChannel('#test')?.members.has('alice')).toBe(false);
	});

	it('renames member in rich member state', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host NICK bob');
		expect(getMember('#test', 'bob')).not.toBeNull();
		expect(getMember('#test', 'alice')).toBeNull();
	});

	it('adds system message to each channel the user was in', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host JOIN #other alice :Alice');
		handle(':alice!a@host NICK bob');
		const testMsgs = getMessages('#test');
		const nickMsg = testMsgs.find((m) => m.type === 'nick');
		expect(nickMsg).toBeDefined();
		expect(nickMsg!.text).toBe('alice is now known as bob');

		const otherMsgs = getMessages('#other');
		const otherNickMsg = otherMsgs.find((m) => m.type === 'nick');
		expect(otherNickMsg).toBeDefined();
	});
});

describe('MODE handling', () => {
	it('adds system message for channel mode changes', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host MODE #test +o bob');
		const msgs = getMessages('#test');
		const modeMsg = msgs.find((m) => m.type === 'mode');
		expect(modeMsg).toBeDefined();
		expect(modeMsg!.text).toContain('+o bob');
	});

	it('ignores user mode changes (non-channel targets)', () => {
		handle(':server MODE alice +i');
		// No channel messages should be created
		expect(getMessages('alice')).toHaveLength(0);
	});

	it('updates member modes on +o', () => {
		handle(':server 353 me = #test :alice bob');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server MODE #test +o alice');

		const member = getMember('#test', 'alice');
		expect(member).not.toBeNull();
		expect(member!.modes).toContain('@');
		expect(member!.highestMode).toBe('@');

		// Simple channel member should also be updated
		const ch = getChannel('#test');
		expect(ch!.members.get('alice')!.prefix).toContain('@');
	});

	it('removes member modes on -o', () => {
		handle(':server 353 me = #test :@alice bob');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server MODE #test -o alice');

		const member = getMember('#test', 'alice');
		expect(member!.modes).not.toContain('@');
		expect(member!.highestMode).toBeNull();

		const ch = getChannel('#test');
		expect(ch!.members.get('alice')!.prefix).not.toContain('@');
	});

	it('handles compound mode changes like +ov nick1 nick2', () => {
		handle(':server 353 me = #test :alice bob');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server MODE #test +ov alice bob');

		expect(getMember('#test', 'alice')!.highestMode).toBe('@');
		expect(getMember('#test', 'bob')!.highestMode).toBe('+');
	});

	it('handles +q for founder (~)', () => {
		handle(':server 353 me = #test :alice');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':ChanServ!ChanServ@localhost MODE #test +q alice');

		const member = getMember('#test', 'alice');
		expect(member!.modes).toContain('~');
		expect(member!.highestMode).toBe('~');
	});

	it('handles mixed +/- in one mode string', () => {
		handle(':server 353 me = #test :@alice +bob');
		handle(':server 366 me #test :End of /NAMES list');
		handle(':server MODE #test -o+v alice alice');

		const member = getMember('#test', 'alice');
		expect(member!.modes).not.toContain('@');
		expect(member!.modes).toContain('+');
		expect(member!.highestMode).toBe('+');
	});
});

describe('+accord/edit handling', () => {
	it('updates original message text in-place when receiving +accord/edit', () => {
		// Add original message
		handle(
			'@msgid=ORIG123;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :Hello wrold'
		);
		expect(getMessage('#test', 'ORIG123')!.text).toBe('Hello wrold');

		// Edit arrives: new message with +accord/edit tag pointing to original
		handle(
			'@msgid=EDIT456;+accord/edit=ORIG123;account=alice;time=2025-01-01T00:01:00Z :alice!a@host PRIVMSG #test :Hello world'
		);

		// Original message should be updated in-place
		const msg = getMessage('#test', 'ORIG123');
		expect(msg).not.toBeNull();
		expect(msg!.text).toBe('Hello world');
		expect(msg!.isEdited).toBe(true);
	});

	it('does not add a new message for an edit', () => {
		handle(
			'@msgid=ORIG1;account=alice :alice!a@host PRIVMSG #test :original'
		);
		handle(
			'@msgid=EDIT1;+accord/edit=ORIG1;account=alice :alice!a@host PRIVMSG #test :edited'
		);

		const msgs = getMessages('#test');
		// Should still be 1 message, not 2
		expect(msgs).toHaveLength(1);
	});

	it('adds as new message if original msgid not found', () => {
		// Edit arrives but original message is not in buffer
		handle(
			'@msgid=EDIT1;+accord/edit=MISSING;account=alice :alice!a@host PRIVMSG #test :edited message'
		);

		const msgs = getMessages('#test');
		// Should be added as a new message since original is missing
		expect(msgs).toHaveLength(1);
		expect(msgs[0].text).toBe('edited message');
	});

	it('stores edit chain mapping for reactions/replies', () => {
		handle(
			'@msgid=ORIG1;account=alice :alice!a@host PRIVMSG #test :v1'
		);
		handle(
			'@msgid=EDIT1;+accord/edit=ORIG1;account=alice :alice!a@host PRIVMSG #test :v2'
		);

		// Reactions to the original msgid should still resolve
		const msg = getMessage('#test', 'ORIG1');
		expect(msg).not.toBeNull();
	});
});

describe('MONITOR -> member presence', () => {
	it('sets member presence to online on RPL_MONONLINE (730)', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		// Simulate going offline first
		handle(':server 731 me :alice!a@host');
		expect(getMember('#test', 'alice')?.presence).toBe('offline');

		handle(':server 730 me :alice!a@host');
		expect(getMember('#test', 'alice')?.presence).toBe('online');
	});

	it('sets member presence to offline on RPL_MONOFFLINE (731)', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':server 731 me :alice!a@host');
		expect(getMember('#test', 'alice')?.presence).toBe('offline');
	});

	it('handles multiple nicks in MONITOR response', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':bob!b@host JOIN #test bob :Bob');
		handle(':server 731 me :alice!a@host,bob!b@host');
		expect(getMember('#test', 'alice')?.presence).toBe('offline');
		expect(getMember('#test', 'bob')?.presence).toBe('offline');
	});
});

// -----------------------------------------------------------------------
// MARKREAD handling
// -----------------------------------------------------------------------

describe('MARKREAD handling', () => {
	it('sets lastReadMsgid from timestamp param', () => {
		handle(':server MARKREAD #test timestamp=2025-01-01T12:00:00Z');
		expect(getLastReadMsgid('#test')).toBe('2025-01-01T12:00:00Z');
	});

	it('ignores MARKREAD without a target', () => {
		// Should not throw
		const parsed = parseMessage(':server MARKREAD');
		handleMessage(parsed);
	});

	it('ignores MARKREAD without a timestamp param', () => {
		handle(':server MARKREAD #test');
		expect(getLastReadMsgid('#test')).toBeNull();
	});
});

// -----------------------------------------------------------------------
// DM routing (PRIVMSG addressed to our nick -> buffer by sender)
// -----------------------------------------------------------------------

describe('DM routing', () => {
	beforeEach(() => {
		userState.nick = 'me';
	});

	it('routes incoming DM to sender nick buffer', () => {
		handle('@msgid=dm1;account=alice :alice!a@host PRIVMSG me :hey there');
		// Message should be in the "alice" buffer, not "me"
		const msgs = getMessages('alice');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].text).toBe('hey there');
		expect(msgs[0].target).toBe('alice');
		// No message in "me" buffer
		expect(getMessages('me')).toHaveLength(0);
	});

	it('routes channel PRIVMSG normally (not DM)', () => {
		handle('@msgid=ch1;account=alice :alice!a@host PRIVMSG #test :hello channel');
		expect(getMessages('#test')).toHaveLength(1);
		expect(getMessages('alice')).toHaveLength(0);
	});

	it('DM routing is case-insensitive for our nick', () => {
		userState.nick = 'Me';
		handle('@msgid=dm2;account=bob :bob!b@host PRIVMSG me :case test');
		const msgs = getMessages('bob');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].text).toBe('case test');
	});
});

// -----------------------------------------------------------------------
// Self-PART handling
// -----------------------------------------------------------------------

describe('self-PART handling', () => {
	beforeEach(() => {
		userState.nick = 'me';
	});

	it('removes channel from channel state on self-PART', () => {
		handle(':me!a@host JOIN #test me :Me Real');
		expect(getChannel('#test')).not.toBeNull();
		handle(':me!a@host PART #test :leaving');
		expect(getChannel('#test')).toBeNull();
	});

	it('clears messages for channel on self-PART', () => {
		handle(':me!a@host JOIN #test me :Me Real');
		handle('@msgid=m1;account=alice :alice!a@host PRIVMSG #test :hello');
		expect(getMessages('#test').length).toBeGreaterThan(0);
		handle(':me!a@host PART #test');
		expect(getMessages('#test')).toHaveLength(0);
	});

	it('switches active channel on self-PART when active channel is parted', () => {
		// Categories are static (from accord.json) and not modified by PART.
		// The handler picks textChannels[0] as the fallback, so list #other first.
		setCategories([{ name: 'Text', channels: ['#other', '#test'] }]);
		handle(':me!a@host JOIN #test me :Me');
		handle(':me!a@host JOIN #other me :Me');
		setActiveChannel('#test');
		expect(getActiveChannel()).toBe('#test');

		handle(':me!a@host PART #test');
		// Should switch to first available text channel from categories
		expect(getActiveChannel()).toBe('#other');
	});

	it('does not produce a system message for self-PART', () => {
		handle(':me!a@host JOIN #test me :Me');
		// Clear join system message
		const prePartMsgs = getMessages('#test');
		handle(':me!a@host PART #test');
		// Messages are cleared entirely, no PART system message
		expect(getMessages('#test')).toHaveLength(0);
	});
});

// -----------------------------------------------------------------------
// KICK handling
// -----------------------------------------------------------------------

describe('KICK handling', () => {
	it('removes kicked user from channel', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':bob!b@host JOIN #test bob :Bob');
		handle(':alice!a@host KICK #test bob :misbehaving');
		expect(getChannel('#test')!.members.has('bob')).toBe(false);
		expect(getMember('#test', 'bob')).toBeNull();
	});

	it('adds system message for kicked user', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':bob!b@host JOIN #test bob :Bob');
		handle(':alice!a@host KICK #test bob :spam');
		const msgs = getMessages('#test');
		const kickMsg = msgs.find((m) => m.text.includes('was kicked'));
		expect(kickMsg).toBeDefined();
		expect(kickMsg!.text).toContain('bob was kicked by alice');
		expect(kickMsg!.text).toContain('spam');
	});

	it('removes channel on self-kick', () => {
		userState.nick = 'me';
		setCategories([{ name: 'Text', channels: ['#other', '#test'] }]);
		handle(':me!a@host JOIN #test me :Me');
		handle(':me!a@host JOIN #other me :Me');
		setActiveChannel('#test');
		handle(':op!o@host KICK #test me :bye');
		expect(getChannel('#test')).toBeNull();
		expect(getMessages('#test')).toHaveLength(0);
		// Should switch to first available text channel
		expect(getActiveChannel()).toBe('#other');
	});

	it('does not produce a system message on self-kick', () => {
		userState.nick = 'me';
		setCategories([{ name: 'Text', channels: ['#test'] }]);
		handle(':me!a@host JOIN #test me :Me');
		handle(':op!o@host KICK #test me :bye');
		// Messages are cleared entirely on self-kick
		expect(getMessages('#test')).toHaveLength(0);
	});
});

// -----------------------------------------------------------------------
// ACCOUNT (account-notify) handling
// -----------------------------------------------------------------------

describe('ACCOUNT handling', () => {
	it('updates account field when user logs in', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host ACCOUNT alice_acct');
		const m = getMember('#test', 'alice');
		expect(m).not.toBeNull();
		expect(m!.account).toBe('alice_acct');
	});

	it('clears account field when user logs out (* sentinel)', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host ACCOUNT alice_acct');
		handle(':alice!a@host ACCOUNT *');
		const m = getMember('#test', 'alice');
		expect(m!.account).toBe('');
	});

	it('updates account across all channels', () => {
		handle(':alice!a@host JOIN #test alice :Alice');
		handle(':alice!a@host JOIN #other alice :Alice');
		handle(':alice!a@host ACCOUNT new_acct');
		expect(getMember('#test', 'alice')!.account).toBe('new_acct');
		expect(getMember('#other', 'alice')!.account).toBe('new_acct');
	});
});

// -----------------------------------------------------------------------
// RPL_WELCOME (001) handling
// -----------------------------------------------------------------------

describe('RPL_WELCOME (001) handling', () => {
	it('updates userState.nick from server-confirmed nick', () => {
		userState.nick = 'requestedNick';
		handle(':server 001 actualNick :Welcome to the network');
		expect(userState.nick).toBe('actualNick');
	});

	it('does not change nick when it already matches', () => {
		userState.nick = 'alice';
		handle(':server 001 alice :Welcome to the network');
		expect(userState.nick).toBe('alice');
	});
});

// -----------------------------------------------------------------------
// Echo-message deduplication
// -----------------------------------------------------------------------

describe('echo-message deduplication', () => {
	beforeEach(() => {
		userState.nick = 'me';
	});

	it('replaces optimistic message instead of duplicating', () => {
		// Add an optimistic placeholder (prefixed with _local_)
		addMessage('#test', {
			msgid: '_local_1',
			nick: 'me',
			account: 'me',
			target: '#test',
			text: 'hello world',
			time: new Date(),
			tags: {},
			reactions: new Map(),
			isRedacted: false,
			type: 'privmsg',
		});
		expect(getMessages('#test')).toHaveLength(1);

		// Server echoes back with real msgid
		handle('@msgid=server123;account=me :me!m@host PRIVMSG #test :hello world');

		// Should still be 1 message, not 2
		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].msgid).toBe('server123');
	});

	it('adds message normally when no optimistic match exists', () => {
		handle('@msgid=s1;account=me :me!m@host PRIVMSG #test :no optimistic');
		expect(getMessages('#test')).toHaveLength(1);
		expect(getMessages('#test')[0].msgid).toBe('s1');
	});
});

// -----------------------------------------------------------------------
// Unread and mention tracking
// -----------------------------------------------------------------------

describe('unread and mention tracking', () => {
	beforeEach(() => {
		userState.nick = 'me';
		userState.account = 'myaccount';
		setActiveChannel('#active');
	});

	it('increments unread for non-active channel', () => {
		handle('@msgid=u1;account=alice :alice!a@host PRIVMSG #other :hello');
		expect(getUnreadCount('#other')).toBeGreaterThan(0);
	});

	it('does not increment unread for active channel', () => {
		handle('@msgid=u2;account=alice :alice!a@host PRIVMSG #active :hello');
		expect(getUnreadCount('#active')).toBe(0);
	});

	it('does not increment unread for own messages', () => {
		handle('@msgid=u3;account=me :me!m@host PRIVMSG #other :my own msg');
		expect(getUnreadCount('#other')).toBe(0);
	});

	it('marks DMs as mentions', () => {
		handle('@msgid=u4;account=alice :alice!a@host PRIVMSG me :hey there');
		expect(getMentionCount('alice')).toBeGreaterThan(0);
	});

	it('detects @mentions in channel messages', () => {
		handle('@msgid=u5;account=alice :alice!a@host PRIVMSG #other :hey @myaccount check this');
		expect(getMentionCount('#other')).toBeGreaterThan(0);
	});

	it('does not flag non-mentions as mentions', () => {
		handle('@msgid=u6;account=alice :alice!a@host PRIVMSG #other :hello world');
		expect(getMentionCount('#other')).toBe(0);
	});
});

// -----------------------------------------------------------------------
// Batch deduplication and append path
// -----------------------------------------------------------------------

describe('BATCH deduplication', () => {
	it('deduplicates batch messages against existing buffer', () => {
		// Add a message that also exists in the batch
		handle('@msgid=msg1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hello');

		// Batch contains the same message plus a new one
		handle(':server BATCH +ref3 chathistory #test');
		handle('@batch=ref3;msgid=msg1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hello');
		handle('@batch=ref3;msgid=msg0;account=bob;time=2024-12-31T23:59:00Z :bob!b@host PRIVMSG #test :older');
		handle(':server BATCH -ref3');

		const msgs = getMessages('#test');
		// Should be 2, not 3 — msg1 is deduplicated
		expect(msgs).toHaveLength(2);
		expect(msgs[0].msgid).toBe('msg0');
		expect(msgs[1].msgid).toBe('msg1');
	});

	it('appends gap-fill messages that are newer than buffer', () => {
		// Existing message
		handle('@msgid=old1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :old');

		// Gap-fill batch with newer messages (AFTER query)
		handle(':server BATCH +ref4 chathistory #test');
		handle('@batch=ref4;msgid=new1;account=bob;time=2025-01-01T01:00:00Z :bob!b@host PRIVMSG #test :newer');
		handle('@batch=ref4;msgid=new2;account=bob;time=2025-01-01T02:00:00Z :bob!b@host PRIVMSG #test :newest');
		handle(':server BATCH -ref4');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(3);
		// Order: old1 (existing), new1 (appended), new2 (appended)
		expect(msgs[0].msgid).toBe('old1');
		expect(msgs[1].msgid).toBe('new1');
		expect(msgs[2].msgid).toBe('new2');
	});
});

// -----------------------------------------------------------------------
// REDACT within batch
// -----------------------------------------------------------------------

describe('BATCH with REDACT', () => {
	it('marks message as redacted within a batch', () => {
		handle(':server BATCH +ref5 chathistory #test');
		handle('@batch=ref5;msgid=r1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :secret');
		handle('@batch=ref5 :mod!m@host REDACT #test r1');
		handle(':server BATCH -ref5');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].isRedacted).toBe(true);
		expect(msgs[0].text).toBe('');
	});
});

// -----------------------------------------------------------------------
// +accord/edit within batch
// -----------------------------------------------------------------------

describe('BATCH with +accord/edit', () => {
	it('updates original message in batch instead of adding duplicate', () => {
		handle(':server BATCH +ref6 chathistory #test');
		handle('@batch=ref6;msgid=orig1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :typo');
		handle('@batch=ref6;msgid=edit1;+accord/edit=orig1;account=alice;time=2025-01-01T00:01:00Z :alice!a@host PRIVMSG #test :fixed');
		handle(':server BATCH -ref6');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].msgid).toBe('orig1');
		expect(msgs[0].text).toBe('fixed');
		expect(msgs[0].isEdited).toBe(true);
	});
});

// -----------------------------------------------------------------------
// TAGMSG reactions within batch (chathistory)
// -----------------------------------------------------------------------

describe('BATCH with TAGMSG reactions', () => {
	it('applies reactions from TAGMSG to messages within the same batch', () => {
		handle(':server BATCH +ref7 chathistory #test');
		handle(
			'@batch=ref7;msgid=m1;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hello'
		);
		handle(
			'@batch=ref7;+draft/react=👍;+draft/reply=m1;account=bob :bob!b@host TAGMSG #test'
		);
		handle(':server BATCH -ref7');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].reactions.get('👍')).toBeDefined();
		expect(msgs[0].reactions.get('👍')!.has('bob')).toBe(true);
	});

	it('toggles reaction off when same user reacts twice in batch', () => {
		handle(':server BATCH +ref8 chathistory #test');
		handle(
			'@batch=ref8;msgid=m2;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hi'
		);
		handle(
			'@batch=ref8;+draft/react=❤️;+draft/reply=m2;account=bob :bob!b@host TAGMSG #test'
		);
		handle(
			'@batch=ref8;+draft/react=❤️;+draft/reply=m2;account=bob :bob!b@host TAGMSG #test'
		);
		handle(':server BATCH -ref8');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		// Second reaction by same user toggles it off
		expect(msgs[0].reactions.has('❤️')).toBe(false);
	});

	it('accumulates reactions from multiple users in batch', () => {
		handle(':server BATCH +ref9 chathistory #test');
		handle(
			'@batch=ref9;msgid=m3;account=alice;time=2025-01-01T00:00:00Z :alice!a@host PRIVMSG #test :hey'
		);
		handle(
			'@batch=ref9;+draft/react=🎉;+draft/reply=m3;account=bob :bob!b@host TAGMSG #test'
		);
		handle(
			'@batch=ref9;+draft/react=🎉;+draft/reply=m3;account=carol :carol!c@host TAGMSG #test'
		);
		handle(':server BATCH -ref9');

		const msgs = getMessages('#test');
		expect(msgs).toHaveLength(1);
		const reactors = msgs[0].reactions.get('🎉');
		expect(reactors).toBeDefined();
		expect(reactors!.size).toBe(2);
		expect(reactors!.has('bob')).toBe(true);
		expect(reactors!.has('carol')).toBe(true);
	});
});
