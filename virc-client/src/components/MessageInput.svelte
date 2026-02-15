<script lang="ts">
	import { markdownToIRC } from '$lib/irc/format';
	import type { IRCConnection } from '$lib/irc/connection';
	import { privmsg, tagmsg, part, topic } from '$lib/irc/commands';
	import { formatMessage } from '$lib/irc/parser';
	import SlashCommandMenu from './SlashCommandMenu.svelte';
	import { filterCommands, type CommandDef } from './SlashCommandMenu.svelte';
	import { getMember } from '$lib/state/members.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { addMessage, generateLocalMsgid } from '$lib/state/messages.svelte';

	interface ReplyContext {
		msgid: string;
		nick: string;
		text: string;
	}

	import { onMount, onDestroy } from 'svelte';

	interface Props {
		target: string;
		connection: IRCConnection | null;
		reply?: ReplyContext | null;
		oncancelreply?: () => void;
		oneditlast?: () => void;
		editing?: boolean;
		oneditcomplete?: () => void;
		oneditcancel?: () => void;
		disconnected?: boolean;
		rateLimitSeconds?: number;
	}

	let { target, connection, reply = null, oncancelreply, oneditlast, editing = false, oneditcomplete, oneditcancel, disconnected = false, rateLimitSeconds = 0 }: Props = $props();

	let text = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	let inputDisabled = $derived(disconnected || rateLimitSeconds > 0);

	// --- Slash command menu state ---

	let slashFilter = $derived.by(() => {
		const match = text.match(/^\/(\S*)$/);
		return match ? match[1] : null;
	});

	let myHighestMode = $derived(
		target.startsWith('#') && userState.nick
			? getMember(target, userState.nick)?.highestMode ?? null
			: null
	);
	let filteredCommands = $derived(slashFilter !== null ? filterCommands(slashFilter, myHighestMode) : []);
	let showSlashMenu = $derived(slashFilter !== null && filteredCommands.length > 0);
	let slashSelectedIndex = $state(0);

	// Reset selection when filter changes
	$effect(() => {
		void slashFilter;
		slashSelectedIndex = 0;
	});

	function handleSlashSelect(cmd: CommandDef): void {
		text = `/${cmd.name} `;
		requestAnimationFrame(() => {
			textarea?.focus();
			if (textarea) {
				textarea.selectionStart = textarea.selectionEnd = text.length;
			}
		});
	}

	function handleSlashMenuKeydown(event: KeyboardEvent): boolean {
		if (!showSlashMenu || filteredCommands.length === 0) return false;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			slashSelectedIndex = (slashSelectedIndex + 1) % filteredCommands.length;
			return true;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			slashSelectedIndex = (slashSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
			return true;
		}
		if (event.key === 'Tab' || event.key === 'Enter') {
			event.preventDefault();
			handleSlashSelect(filteredCommands[slashSelectedIndex]);
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			// Add space to break the menu match
			text = text + ' ';
			return true;
		}
		return false;
	}

	// Listen for programmatic edit-message events (from keyboard shortcut: Up arrow)
	function handleEditMessage(e: Event): void {
		const detail = (e as CustomEvent<{ text: string }>).detail;
		if (detail?.text) {
			text = detail.text;
			requestAnimationFrame(() => {
				adjustHeight();
				textarea?.focus();
				// Place cursor at end
				if (textarea) {
					textarea.selectionStart = textarea.selectionEnd = text.length;
				}
			});
		}
	}

	// Listen for mention insertion events (from MemberList context menu)
	function handleInsertMention(e: Event): void {
		const detail = (e as CustomEvent<{ nick: string }>).detail;
		if (detail?.nick) {
			const mention = `@${detail.nick} `;
			text += mention;
			requestAnimationFrame(() => {
				adjustHeight();
				textarea?.focus();
				if (textarea) {
					textarea.selectionStart = textarea.selectionEnd = text.length;
				}
			});
		}
	}

	onMount(() => {
		window.addEventListener('virc:edit-message', handleEditMessage);
		window.addEventListener('virc:insert-mention', handleInsertMention);
	});

	onDestroy(() => {
		window.removeEventListener('virc:edit-message', handleEditMessage);
		window.removeEventListener('virc:insert-mention', handleInsertMention);
		clearTypingTimer();
	});

	let statusMessage = $derived.by(() => {
		if (disconnected) return "You're offline. Reconnecting...";
		if (rateLimitSeconds > 0) return `Slow down! You can send another message in ${rateLimitSeconds}s.`;
		return null;
	});

	// --- Auto-growing textarea ---

	function adjustHeight(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
		const maxHeight = lineHeight * 10;
		textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
	}

	// --- Typing indicator throttle ---

	let lastTypingSent = 0;
	let typingDoneTimer: ReturnType<typeof setTimeout> | null = null;
	const TYPING_THROTTLE_MS = 3_000;
	const TYPING_DONE_DELAY_MS = 5_000;

	function sendTypingActive(): void {
		if (!connection) return;
		const now = Date.now();
		if (now - lastTypingSent >= TYPING_THROTTLE_MS) {
			tagmsg(connection, target, { '+typing': 'active' });
			lastTypingSent = now;
		}

		// Reset the done timer
		if (typingDoneTimer !== null) {
			clearTimeout(typingDoneTimer);
		}
		typingDoneTimer = setTimeout(() => {
			if (connection) {
				tagmsg(connection, target, { '+typing': 'done' });
			}
			typingDoneTimer = null;
		}, TYPING_DONE_DELAY_MS);
	}

	function clearTypingTimer(): void {
		if (typingDoneTimer !== null) {
			clearTimeout(typingDoneTimer);
			typingDoneTimer = null;
		}
	}

	// --- Slash command handling ---

	function handleSlashCommand(input: string): boolean {
		if (!connection) return false;
		const match = input.match(/^\/(\S+)\s*(.*)/);
		if (!match) return false;

		const [, cmd, args] = match;
		const command = cmd.toLowerCase();

		switch (command) {
			case 'me':
				// ACTION: send as CTCP ACTION
				connection.send(formatMessage('PRIVMSG', target, `\x01ACTION ${args}\x01`));
				return true;
			case 'msg': {
				const msgMatch = args.match(/^(\S+)\s+(.*)/);
				if (msgMatch) {
					privmsg(connection, msgMatch[1], msgMatch[2]);
				}
				return true;
			}
			case 'nick':
				if (args.trim()) {
					connection.send(formatMessage('NICK', args.trim()));
				}
				return true;
			case 'part': {
				const partArgs = args.trim();
				let partTarget: string;
				let reason: string | undefined;
				if (!partArgs) {
					// /part — leave current channel
					partTarget = target;
				} else if (partArgs.startsWith('#') || partArgs.startsWith('&')) {
					// /part #channel [reason] — leave specified channel
					const spaceIdx = partArgs.indexOf(' ');
					if (spaceIdx === -1) {
						partTarget = partArgs;
					} else {
						partTarget = partArgs.slice(0, spaceIdx);
						reason = partArgs.slice(spaceIdx + 1).trim() || undefined;
					}
				} else {
					// /part reason — leave current channel with reason
					partTarget = target;
					reason = partArgs;
				}
				part(connection, partTarget, reason);
				return true;
			}
			case 'topic':
				if (args.trim()) {
					topic(connection, target, args.trim());
				} else {
					topic(connection, target);
				}
				return true;
			case 'invite': {
				const inviteParts = args.trim().split(/\s+/);
				const inviteUser = inviteParts[0];
				const inviteChannel = inviteParts[1] || target;
				if (inviteUser) {
					connection.send(formatMessage('INVITE', inviteUser, inviteChannel));
				}
				return true;
			}
			case 'kick': {
				const kickMatch = args.match(/^(\S+)\s*(.*)/);
				if (kickMatch) {
					const reason = kickMatch[2] || undefined;
					if (reason) {
						connection.send(formatMessage('KICK', target, kickMatch[1], reason));
					} else {
						connection.send(formatMessage('KICK', target, kickMatch[1]));
					}
				}
				return true;
			}
			case 'ban': {
				const banUser = args.trim();
				if (banUser) {
					connection.send(formatMessage('MODE', target, '+b', `${banUser}!*@*`));
				}
				return true;
			}
			case 'unban': {
				const unbanUser = args.trim();
				if (unbanUser) {
					connection.send(formatMessage('MODE', target, '-b', `${unbanUser}!*@*`));
				}
				return true;
			}
			case 'mode':
				if (args.trim()) {
					connection.send(`MODE ${args.trim()}`);
				}
				return true;
			default:
				return false;
		}
	}

	// --- Formatting shortcuts ---

	function wrapSelection(wrapper: string): void {
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;

		if (start === end) return; // No selection

		const before = text.slice(0, start);
		const selected = text.slice(start, end);
		const after = text.slice(end);

		text = before + wrapper + selected + wrapper + after;

		// Restore cursor after the wrapped text
		requestAnimationFrame(() => {
			if (!textarea) return;
			textarea.setSelectionRange(start + wrapper.length, end + wrapper.length);
			textarea.focus();
		});
	}

	// --- Send message ---

	function send(): void {
		const trimmed = text.trim();
		if (!trimmed || !connection || inputDisabled) return;

		// Check for slash commands (// escapes to send a literal /message)
		if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
			if (handleSlashCommand(trimmed)) {
				text = '';
				cancelReply();
				clearTypingTimer();
				requestAnimationFrame(adjustHeight);
				return;
			}
		}

		// Strip leading // escape to send literal /text
		const messageText = trimmed.startsWith('//') ? trimmed.slice(1) : trimmed;

		// Convert markdown to mIRC codes
		const ircText = markdownToIRC(messageText);

		// Add optimistic message immediately so it appears without waiting for server echo
		addMessage(target, {
			msgid: generateLocalMsgid(),
			nick: userState.nick ?? '',
			account: userState.account ?? '',
			target,
			text: ircText,
			time: new Date(),
			tags: {},
			replyTo: reply?.msgid,
			reactions: new Map(),
			isRedacted: false,
			type: 'privmsg',
			sendState: 'sending',
		});

		if (reply) {
			// Send with reply tag
			const tags = `@+draft/reply=${reply.msgid}`;
			connection.send(`${tags} PRIVMSG ${target} :${ircText}`);
		} else {
			privmsg(connection, target, ircText);
		}

		// If we were editing, redact the original message now that the edit is sent
		if (editing) {
			oneditcomplete?.();
		}

		text = '';
		cancelReply();
		clearTypingTimer();

		// Send typing=done since we just sent a message
		if (connection) {
			tagmsg(connection, target, { '+typing': 'done' });
		}

		requestAnimationFrame(adjustHeight);
	}

	function cancelReply(): void {
		oncancelreply?.();
	}

	// --- Key handling ---

	function handleKeydown(event: KeyboardEvent): void {
		// Let slash command menu handle navigation keys when open
		if (handleSlashMenuKeydown(event)) return;

		// Formatting shortcuts
		if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
			if (event.key === 'b') {
				event.preventDefault();
				wrapSelection('**');
				return;
			}
			if (event.key === 'i') {
				event.preventDefault();
				wrapSelection('*');
				return;
			}
		}

		if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'C') {
			// Ctrl+Shift+C for code (uppercase C because shift is held)
			event.preventDefault();
			wrapSelection('`');
			return;
		}

		// Up arrow in empty input — edit last message
		if (event.key === 'ArrowUp' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
			if (text.trim() === '') {
				event.preventDefault();
				oneditlast?.();
				return;
			}
		}

		// Escape cancels reply or edit
		if (event.key === 'Escape') {
			if (editing) {
				event.preventDefault();
				text = '';
				oneditcancel?.();
				requestAnimationFrame(adjustHeight);
				return;
			}
			if (reply) {
				event.preventDefault();
				cancelReply();
				return;
			}
		}

		// Enter sends, Shift+Enter inserts newline
		if (event.key === 'Enter' && !event.shiftKey) {
			// If slash menu is open, it already handled Enter above
			event.preventDefault();
			send();
			return;
		}
	}

	function handleInput(): void {
		requestAnimationFrame(adjustHeight);
		if (text.trim().length > 0) {
			sendTypingActive();
		}
	}

	// Focus the textarea when a reply context is set or channel changes
	$effect(() => {
		if (reply) {
			requestAnimationFrame(() => textarea?.focus());
		}
	});

	$effect(() => {
		void target; // re-run when target (channel) changes
		requestAnimationFrame(() => textarea?.focus());
	});

	let placeholder = $derived(
		target.startsWith('#')
			? `Message ${target}`
			: `Message @${target}`
	);
</script>

<div class="message-input-container">
	{#if statusMessage}
		<div class="input-status-bar" class:input-status-warning={rateLimitSeconds > 0} class:input-status-offline={disconnected} role="status" aria-live="polite">
			{statusMessage}
		</div>
	{/if}

	{#if reply}
		<div class="reply-bar">
			<span class="reply-label">
				Replying to <strong>{reply.nick}</strong>:
				<span class="reply-preview-text">
					{reply.text.slice(0, 100)}{reply.text.length > 100 ? '...' : ''}
				</span>
			</span>
			<button class="reply-cancel" title="Cancel reply" onclick={cancelReply}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
				</svg>
			</button>
		</div>
	{/if}

	<div class="input-row" class:input-disabled={inputDisabled}>
		{#if showSlashMenu}
			<SlashCommandMenu
				commands={filteredCommands}
				selectedIndex={slashSelectedIndex}
				onselect={handleSlashSelect}
				onhover={(i) => slashSelectedIndex = i}
			/>
		{/if}
		<textarea
			bind:this={textarea}
			bind:value={text}
			placeholder={inputDisabled ? '' : placeholder}
			rows="1"
			disabled={inputDisabled}
			onkeydown={handleKeydown}
			oninput={handleInput}
		></textarea>
	</div>
</div>

<style>
	.message-input-container {
		padding: 0 16px 16px;
		flex-shrink: 0;
	}

	.reply-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--surface-high);
		border-radius: 8px 8px 0 0;
		font-size: var(--font-sm);
		color: var(--text-secondary);
		gap: 8px;
	}

	.reply-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.reply-label strong {
		color: var(--text-primary);
	}

	.reply-preview-text {
		color: var(--text-muted);
	}

	.reply-cancel {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		border-radius: 4px;
		flex-shrink: 0;
		transition: color var(--duration-message) ease, background var(--duration-message) ease;
	}

	.reply-cancel:hover {
		color: var(--interactive-hover);
		background: var(--surface-highest);
	}

	.input-row {
		display: flex;
		align-items: flex-end;
		background: var(--surface-high);
		border-radius: 8px;
		padding: 8px 12px;
		position: relative;
	}

	.reply-bar + .input-row {
		border-radius: 0 0 8px 8px;
		border-top: 1px solid var(--surface-highest);
	}

	textarea {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--font-base);
		line-height: 1.375;
		resize: none;
		overflow-y: auto;
		min-height: 22px;
		max-height: calc(22px * 10);
		padding: 0;
	}

	textarea::placeholder {
		color: var(--text-muted);
	}

	textarea:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	/* Input status bar */
	.input-status-bar {
		padding: 6px 12px;
		font-size: var(--font-xs);
		font-weight: var(--weight-medium);
		border-radius: 8px 8px 0 0;
		text-align: center;
	}

	.input-status-offline {
		background: var(--danger-bg);
		color: var(--danger);
	}

	.input-status-warning {
		background: var(--warning-bg);
		color: var(--warning);
	}

	.input-status-bar + .reply-bar {
		border-radius: 0;
	}

	.input-status-bar + .input-row,
	.input-status-bar + .reply-bar + .input-row {
		border-radius: 0 0 8px 8px;
		border-top: 1px solid var(--surface-highest);
	}

	.input-disabled {
		opacity: 0.6;
	}
</style>
