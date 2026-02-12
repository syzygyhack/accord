<script lang="ts">
	import { markdownToIRC } from '$lib/irc/format';
	import type { IRCConnection } from '$lib/irc/connection';
	import { privmsg, tagmsg, join, part, topic } from '$lib/irc/commands';
	import { formatMessage } from '$lib/irc/parser';

	interface ReplyContext {
		msgid: string;
		nick: string;
		text: string;
	}

	interface Props {
		target: string;
		connection: IRCConnection | null;
		reply?: ReplyContext | null;
		oncancelreply?: () => void;
	}

	let { target, connection, reply = null, oncancelreply }: Props = $props();

	let text = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

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
			case 'join':
				if (args.trim()) {
					join(connection, args.trim().split(/[,\s]+/));
				}
				return true;
			case 'part': {
				const partTarget = args.trim() || target;
				part(connection, partTarget);
				return true;
			}
			case 'topic':
				if (args.trim()) {
					topic(connection, target, args.trim());
				} else {
					topic(connection, target);
				}
				return true;
			case 'nick':
				if (args.trim()) {
					connection.send(formatMessage('NICK', args.trim()));
				}
				return true;
			case 'msg': {
				const msgMatch = args.match(/^(\S+)\s+(.*)/);
				if (msgMatch) {
					privmsg(connection, msgMatch[1], msgMatch[2]);
				}
				return true;
			}
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
			const newEnd = end + wrapper.length * 2;
			textarea.setSelectionRange(start + wrapper.length, end + wrapper.length);
			textarea.focus();
		});
	}

	// --- Send message ---

	function send(): void {
		const trimmed = text.trim();
		if (!trimmed || !connection) return;

		// Check for slash commands
		if (trimmed.startsWith('/')) {
			if (handleSlashCommand(trimmed)) {
				text = '';
				cancelReply();
				clearTypingTimer();
				requestAnimationFrame(adjustHeight);
				return;
			}
		}

		// Convert markdown to mIRC codes
		const ircText = markdownToIRC(trimmed);

		if (reply) {
			// Send with reply tag
			const tags = `@+draft/reply=${reply.msgid}`;
			connection.send(`${tags} PRIVMSG ${target} :${ircText}`);
		} else {
			privmsg(connection, target, ircText);
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

		// Escape cancels reply
		if (event.key === 'Escape' && reply) {
			event.preventDefault();
			cancelReply();
			return;
		}

		// Enter sends, Shift+Enter inserts newline
		if (event.key === 'Enter' && !event.shiftKey) {
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

	let placeholder = $derived(
		target.startsWith('#')
			? `Message ${target}`
			: `Message @${target}`
	);
</script>

<div class="message-input-container">
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

	<div class="input-row">
		<textarea
			bind:this={textarea}
			bind:value={text}
			{placeholder}
			rows="1"
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
</style>
