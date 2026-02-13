<script lang="ts">
	import { renderMessage, nickColor } from '$lib/irc/format';
	import { getMessage } from '$lib/state/messages.svelte';
	import { userState } from '$lib/state/user.svelte';
	import type { Message } from '$lib/state/messages.svelte';

	interface Props {
		message: Message;
		isGrouped: boolean;
		isFirstInGroup: boolean;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		ontogglereaction?: (msgid: string, emoji: string) => void;
		onscrolltomessage?: (msgid: string) => void;
		onretry?: (msgid: string) => void;
	}

	let {
		message,
		isGrouped,
		isFirstInGroup,
		onreply,
		onreact,
		onmore,
		ontogglereaction,
		onscrolltomessage,
		onretry,
	}: Props = $props();

	let isFailed = $derived(message.sendState === 'failed');
	let isSending = $derived(message.sendState === 'sending');

	function handleRetry() {
		onretry?.(message.msgid);
	}

	let hovered = $state(false);

	let color = $derived(nickColor(message.account));

	let renderedText = $derived(() => {
		if (message.isRedacted) return '';
		return renderMessage(message.text, userState.account ?? '');
	});

	let fullTimestamp = $derived(
		message.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	);

	let shortTimestamp = $derived(
		message.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	);

	let initial = $derived(message.nick.charAt(0).toUpperCase());

	let replyParent = $derived(
		message.replyTo ? getMessage(message.target, message.replyTo) : null
	);

	let reactionEntries = $derived(() => {
		const entries: { emoji: string; count: number; hasSelf: boolean }[] = [];
		for (const [emoji, accounts] of message.reactions) {
			entries.push({
				emoji,
				count: accounts.size,
				hasSelf: accounts.has(userState.account ?? ''),
			});
		}
		return entries;
	});

	function handleReply() {
		onreply?.(message.msgid);
	}

	function handleReact() {
		onreact?.(message.msgid);
	}

	function handleMore(event: MouseEvent) {
		onmore?.(message.msgid, event);
	}

	function handleToggleReaction(emoji: string) {
		ontogglereaction?.(message.msgid, emoji);
	}

	function handleScrollToParent() {
		if (message.replyTo) {
			onscrolltomessage?.(message.replyTo);
		}
	}

	/** Insert @nick mention when clicking a nick in a message. */
	function handleNickClick() {
		window.dispatchEvent(
			new CustomEvent('virc:insert-mention', { detail: { nick: message.nick } })
		);
	}
</script>

<div
	class="message"
	class:message-grouped={isGrouped && !isFirstInGroup}
	class:message-redacted={message.isRedacted}
	class:message-failed={isFailed}
	class:message-sending={isSending}
	role="article"
	aria-label="{message.nick}: {message.isRedacted ? 'message deleted' : message.text.slice(0, 100)}"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
	onfocusin={() => (hovered = true)}
	onfocusout={() => (hovered = false)}
>
	{#if !message.isRedacted}
		<div class="hover-toolbar" class:toolbar-visible={hovered} aria-label="Message actions">
			<button class="toolbar-btn" title="Add Reaction" aria-label="Add Reaction" onclick={handleReact}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1.2A5.8 5.8 0 1013.8 8 5.8 5.8 0 008 2.2zM5.5 6a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zm-6 3.5a.6.6 0 01.8-.3A5.3 5.3 0 008 10a5.3 5.3 0 002.7-.8.6.6 0 01.6 1A6.5 6.5 0 018 11.2a6.5 6.5 0 01-3.3-1 .6.6 0 01-.2-.7z"/>
				</svg>
			</button>
			<button class="toolbar-btn" title="Reply" aria-label="Reply" onclick={handleReply}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M6.6 3.4L1.2 7.6a.5.5 0 000 .8l5.4 4.2a.5.5 0 00.8-.4V10c3 0 5.4.8 7 3.6.2.4.6.4.6-.1C15 9.1 12 5.5 7.4 5.2V3.8a.5.5 0 00-.8-.4z"/>
				</svg>
			</button>
			<button class="toolbar-btn" title="More" aria-label="More options" onclick={handleMore}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<circle cx="4" cy="8" r="1.5"/>
					<circle cx="8" cy="8" r="1.5"/>
					<circle cx="12" cy="8" r="1.5"/>
				</svg>
			</button>
		</div>
	{/if}

	{#if isFirstInGroup || !isGrouped}
		{#if replyParent}
				<div class="reply-preview" role="button" tabindex="0" onclick={handleScrollToParent} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleScrollToParent(); } }}>
				<svg class="reply-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
					<path d="M5 2.3L1 5.6a.4.4 0 000 .6L5 9.5a.4.4 0 00.6-.3V7.5c2.2 0 4 .6 5.2 2.7.2.3.5.3.5-.1C11.3 6.8 9 4.1 5.6 3.9V2.6a.4.4 0 00-.6-.3z"/>
				</svg>
				<span class="reply-nick" style="color: {nickColor(replyParent.account)}">
					{replyParent.nick}
				</span>
				<span class="reply-text">
					{replyParent.isRedacted
						? '[message deleted]'
						: replyParent.text.slice(0, 100) + (replyParent.text.length > 100 ? '...' : '')}
				</span>
			</div>
		{/if}

		<div class="message-header">
			<div class="avatar" style="background-color: {color}">
				{initial}
			</div>
			<div class="message-body">
				<div class="message-meta">
					<span class="nick" style="color: {color}" role="button" tabindex="0" onclick={handleNickClick} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNickClick(); } }}>{message.nick}</span>
					<span class="timestamp">{fullTimestamp}</span>
				</div>
				{#if message.isRedacted}
					<div class="message-text redacted">[message deleted]</div>
				{:else}
					<div class="message-text">{@html renderedText()}</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="message-grouped-row">
			<span class="timestamp-gutter" class:visible={hovered}>
				{shortTimestamp}
			</span>
			{#if message.isRedacted}
				<div class="message-text redacted">[message deleted]</div>
			{:else}
				<div class="message-text">{@html renderedText()}</div>
			{/if}
		</div>
	{/if}

	{#if reactionEntries().length > 0}
		<div class="reactions-bar">
			{#each reactionEntries() as entry (entry.emoji)}
				<button
					class="reaction-pill"
					class:reaction-self={entry.hasSelf}
					onclick={() => handleToggleReaction(entry.emoji)}
				>
					<span class="reaction-emoji">{entry.emoji}</span>
					<span class="reaction-count">{entry.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if isFailed}
		<div class="send-failed">
			<svg class="send-failed-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
				<path d="M7 0a7 7 0 110 14A7 7 0 017 0zm0 9.8a.9.9 0 100 1.8.9.9 0 000-1.8zM7.7 3.5H6.3l.2 5h1l.2-5z"/>
			</svg>
			<span class="send-failed-text">Failed to send</span>
			<button class="send-failed-retry" onclick={handleRetry}>Retry</button>
		</div>
	{/if}
</div>

<style>
	.message {
		position: relative;
		padding: 2px 48px 2px 72px;
		min-height: 1.375rem;
		transition: background var(--duration-message) ease;
	}

	.message:hover {
		background: var(--msg-hover-bg);
	}

	.message-grouped {
		padding-top: 0;
		padding-bottom: 0;
	}

	.message-redacted {
		opacity: 0.5;
	}

	.message-sending {
		opacity: 0.6;
	}

	.message-failed {
		border-left: 3px solid var(--danger);
		padding-left: 69px;
	}

	/* Send failure indicator */
	.send-failed {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 0 2px 0;
		font-size: var(--font-xs);
		color: var(--danger);
	}

	.send-failed-icon {
		flex-shrink: 0;
	}

	.send-failed-text {
		font-weight: var(--weight-medium);
	}

	.send-failed-retry {
		padding: 2px 8px;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--danger);
		font-family: inherit;
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		cursor: pointer;
		text-decoration: underline;
	}

	.send-failed-retry:hover {
		color: var(--text-primary);
	}

	/* Hover Toolbar — always in DOM for keyboard accessibility, hidden until hover/focus */
	.hover-toolbar {
		position: absolute;
		top: -16px;
		right: 16px;
		display: flex;
		gap: 0;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
		z-index: 10;
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--duration-toolbar) ease;
	}

	.hover-toolbar.toolbar-visible,
	.hover-toolbar:focus-within {
		opacity: 1;
		pointer-events: auto;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--interactive-normal);
		cursor: pointer;
		transition: background var(--duration-message) ease, color var(--duration-message) ease;
	}

	.toolbar-btn:hover {
		background: var(--surface-highest);
		color: var(--interactive-hover);
	}

	.toolbar-btn:first-child {
		border-radius: 3px 0 0 3px;
	}

	.toolbar-btn:last-child {
		border-radius: 0 3px 3px 0;
	}

	/* Reply Preview */
	.reply-preview {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 0 4px 52px;
		margin-left: 20px;
		font-size: var(--font-xs);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.reply-preview:hover {
		color: var(--text-primary);
	}

	.reply-icon {
		flex-shrink: 0;
		color: var(--interactive-normal);
	}

	.reply-nick {
		font-weight: var(--weight-semibold);
		flex-shrink: 0;
	}

	.reply-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Message Header (first in group) */
	.message-header {
		display: flex;
		gap: 16px;
	}

	.avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--weight-semibold);
		font-size: var(--font-md);
		color: var(--text-inverse);
		margin-left: -56px;
	}

	.message-body {
		min-width: 0;
		flex: 1;
	}

	.message-meta {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.nick {
		font-weight: var(--weight-semibold);
		font-size: var(--font-base);
		cursor: pointer;
	}

	.nick:hover {
		text-decoration: underline;
	}

	.timestamp {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}

	/* Grouped message row */
	.message-grouped-row {
		display: flex;
		align-items: flex-start;
	}

	.timestamp-gutter {
		width: 56px;
		margin-left: -56px;
		text-align: right;
		padding-right: 16px;
		font-size: var(--font-xs);
		color: var(--text-muted);
		opacity: 0;
		flex-shrink: 0;
		user-select: none;
	}

	.timestamp-gutter.visible {
		opacity: 1;
	}

	/* Message Text */
	.message-text {
		line-height: 1.375;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	.message-text.redacted {
		color: var(--text-muted);
		font-style: italic;
	}

	/* Inline formatting styles via :global for renderIRC output */
	.message-text :global(a) {
		color: var(--text-link);
		text-decoration: none;
	}

	.message-text :global(a:hover) {
		text-decoration: underline;
	}

	.message-text :global(code) {
		font-family: var(--font-mono);
		font-size: var(--font-sm);
		padding: 0.15em 0.3em;
		background: var(--surface-highest);
		border-radius: 3px;
	}

	.message-text :global(.mention) {
		padding: 0 2px;
		border-radius: 3px;
		background: var(--accent-bg);
		color: var(--accent-primary);
		cursor: pointer;
		font-weight: var(--weight-medium);
	}

	.message-text :global(.mention-self) {
		background: var(--msg-mention-bg);
	}

	.message-text :global(.channel-ref) {
		color: var(--accent-primary);
		cursor: pointer;
		font-weight: var(--weight-medium);
	}

	.message-text :global(.channel-ref:hover) {
		text-decoration: underline;
	}

	/* Reactions Bar */
	.reactions-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px 0 2px 0;
	}

	.reaction-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border: 1px solid var(--surface-highest);
		border-radius: 8px;
		background: var(--surface-high);
		cursor: pointer;
		font-size: var(--font-sm);
		color: var(--text-secondary);
		transition:
			background var(--duration-reaction) ease,
			border-color var(--duration-reaction) ease;
	}

	.reaction-pill:hover {
		background: var(--surface-highest);
		border-color: var(--interactive-muted);
	}

	.reaction-self {
		border-color: var(--accent-primary);
		background: var(--accent-bg);
	}

	.reaction-emoji {
		font-size: var(--font-base);
		line-height: 1;
	}

	.reaction-count {
		font-size: var(--font-xs);
		font-weight: var(--weight-semibold);
		min-width: 1ch;
		text-align: center;
	}
</style>
