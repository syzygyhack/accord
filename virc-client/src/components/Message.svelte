<script lang="ts">
	import { renderMessage, nickColor } from '$lib/irc/format';
	import { getMessage } from '$lib/state/messages.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { extractMediaUrls } from '$lib/media';
	import { getCustomEmojiUrl } from '$lib/emoji';
	import type { Message } from '$lib/state/messages.svelte';

	interface Props {
		message: Message;
		isGrouped: boolean;
		isFirstInGroup: boolean;
		compact?: boolean;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		ontogglereaction?: (msgid: string, emoji: string) => void;
		onscrolltomessage?: (msgid: string) => void;
		onretry?: (msgid: string) => void;
		onnickclick?: (nick: string, account: string, event: MouseEvent) => void;
	}

	let {
		message,
		isGrouped,
		isFirstInGroup,
		compact = false,
		onreply,
		onreact,
		onmore,
		ontogglereaction,
		onscrolltomessage,
		onretry,
		onnickclick,
	}: Props = $props();

	let isFailed = $derived(message.sendState === 'failed');
	let isSending = $derived(message.sendState === 'sending');

	function handleRetry() {
		onretry?.(message.msgid);
	}

	let hovered = $state(false);

	let color = $derived(nickColor(message.account));

	let renderedText = $derived.by(() => {
		if (message.isRedacted) return '';
		return renderMessage(message.text, userState.account ?? '');
	});

	let mediaUrls = $derived.by(() => {
		if (message.isRedacted) return [];
		return extractMediaUrls(message.text);
	});

	let lightboxUrl = $state<string | null>(null);

	function openLightbox(url: string) {
		lightboxUrl = url;
	}

	function closeLightbox() {
		lightboxUrl = null;
	}

	function handleLightboxKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeLightbox();
		}
	}

	function handleLightboxClick(e: MouseEvent) {
		// Close if clicking the overlay backdrop (not the image itself)
		if (e.target === e.currentTarget) {
			closeLightbox();
		}
	}

	let timestamp = $derived(
		message.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	);

	let initial = $derived(message.nick.charAt(0).toUpperCase());

	let replyParent = $derived(
		message.replyTo ? getMessage(message.target, message.replyTo) : null
	);

	let reactionEntries = $derived.by(() => {
		const entries: { emoji: string; count: number; hasSelf: boolean; customUrl: string | null }[] = [];
		for (const [emoji, accounts] of message.reactions) {
			// Check if this is a custom emoji (:name: format)
			let customUrl: string | null = null;
			const customMatch = emoji.match(/^:([a-zA-Z0-9_-]+):$/);
			if (customMatch) {
				const url = getCustomEmojiUrl(customMatch[1]);
				if (url) customUrl = url;
			}
			entries.push({
				emoji,
				count: accounts.size,
				hasSelf: accounts.has(userState.account ?? ''),
				customUrl,
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

	/** Open profile popout when clicking a nick in a message. */
	function handleNickClick(event: MouseEvent) {
		onnickclick?.(message.nick, message.account, event);
	}
</script>

{#if compact}
<div
	class="message message-compact"
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
			<button class="toolbar-btn toolbar-btn-danger" title="Delete" aria-label="Delete message" onclick={handleMore}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M5.5 1.5A.5.5 0 016 1h4a.5.5 0 01.5.5V2h3a.5.5 0 010 1h-.538l-.853 10.24A1.5 1.5 0 0110.62 14.5H5.38a1.5 1.5 0 01-1.489-1.26L3.038 3H2.5a.5.5 0 010-1h3v-.5zM4.046 3l.84 10.08a.5.5 0 00.497.42h5.236a.5.5 0 00.497-.42L11.954 3H4.046zM6.5 5a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5zm3 0a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5z"/>
				</svg>
			</button>
		</div>
	{/if}

	{#if replyParent}
		<div class="compact-reply-line">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			<div class="reply-preview compact-reply-preview" role="button" tabindex="0" onclick={handleScrollToParent} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleScrollToParent(); } }}>
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
		</div>
	{/if}

	<div class="compact-row">
		<span class="compact-timestamp">{timestamp}</span>
		<span class="compact-nick" style="color: {color}" role="button" tabindex="0" onclick={handleNickClick} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); handleNickClick(new MouseEvent('click', { clientX: rect.left, clientY: rect.bottom })); } }}>{message.nick}</span>
		<div class="compact-text">
			{#if message.isRedacted}
				<span class="message-text redacted">[message deleted]</span>
			{:else}
				<span class="message-text">{@html renderedText}</span>
			{/if}
		</div>
	</div>

	{#if !message.isRedacted && mediaUrls.length > 0}
		<div class="compact-media-row">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			<div class="media-previews">
				{#each mediaUrls as media (media.url)}
					{#if media.type === 'image'}
						<button class="media-thumbnail-btn" onclick={() => openLightbox(media.url)}>
							<img class="media-thumbnail" src={media.url} alt="Image preview" loading="lazy" />
						</button>
					{:else if media.type === 'video'}
						<video class="media-video" controls preload="metadata">
							<source src={media.url} />
							<track kind="captions" />
						</video>
					{:else if media.type === 'audio'}
						<audio class="media-audio" controls preload="metadata">
							<source src={media.url} />
						</audio>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	{#if reactionEntries.length > 0}
		<div class="compact-reactions-row">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			<div class="reactions-bar">
				{#each reactionEntries as entry (entry.emoji)}
					<button
						class="reaction-pill"
						class:reaction-self={entry.hasSelf}
						onclick={() => handleToggleReaction(entry.emoji)}
					>
						<span class="reaction-emoji">
							{#if entry.customUrl}
								<img class="reaction-custom-emoji" src={entry.customUrl} alt={entry.emoji} title={entry.emoji} />
							{:else}
								{entry.emoji}
							{/if}
						</span>
						<span class="reaction-count">{entry.count}</span>
					</button>
				{/each}
			</div>
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
{:else}
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
			<button class="toolbar-btn toolbar-btn-danger" title="Delete" aria-label="Delete message" onclick={handleMore}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
					<path d="M5.5 1.5A.5.5 0 016 1h4a.5.5 0 01.5.5V2h3a.5.5 0 010 1h-.538l-.853 10.24A1.5 1.5 0 0110.62 14.5H5.38a1.5 1.5 0 01-1.489-1.26L3.038 3H2.5a.5.5 0 010-1h3v-.5zM4.046 3l.84 10.08a.5.5 0 00.497.42h5.236a.5.5 0 00.497-.42L11.954 3H4.046zM6.5 5a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5zm3 0a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5z"/>
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
					<span class="nick" style="color: {color}" role="button" tabindex="0" onclick={handleNickClick} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); handleNickClick(new MouseEvent('click', { clientX: rect.left, clientY: rect.bottom })); } }}>{message.nick}</span>
					<span class="timestamp">{timestamp}</span>
				</div>
				{#if message.isRedacted}
					<div class="message-text redacted">[message deleted]</div>
				{:else}
					<div class="message-text">{@html renderedText}</div>
					{#if mediaUrls.length > 0}
						<div class="media-previews">
							{#each mediaUrls as media (media.url)}
								{#if media.type === 'image'}
									<button class="media-thumbnail-btn" onclick={() => openLightbox(media.url)}>
										<img
											class="media-thumbnail"
											src={media.url}
											alt="Image preview"
											loading="lazy"
										/>
									</button>
								{:else if media.type === 'video'}
									<video class="media-video" controls preload="metadata">
										<source src={media.url} />
										<track kind="captions" />
									</video>
								{:else if media.type === 'audio'}
									<audio class="media-audio" controls preload="metadata">
										<source src={media.url} />
									</audio>
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{:else}
		<div class="message-grouped-row">
			<span class="timestamp-gutter" class:visible={hovered}>
				{timestamp}
			</span>
			{#if message.isRedacted}
				<div class="message-text redacted">[message deleted]</div>
			{:else}
				<div class="message-text">{@html renderedText}</div>
				{#if mediaUrls.length > 0}
					<div class="media-previews">
						{#each mediaUrls as media (media.url)}
							{#if media.type === 'image'}
								<button class="media-thumbnail-btn" onclick={() => openLightbox(media.url)}>
									<img
										class="media-thumbnail"
										src={media.url}
										alt="Image preview"
										loading="lazy"
									/>
								</button>
							{:else if media.type === 'video'}
								<video class="media-video" controls preload="metadata">
									<source src={media.url} />
									<track kind="captions" />
								</video>
							{:else if media.type === 'audio'}
								<audio class="media-audio" controls preload="metadata">
									<source src={media.url} />
								</audio>
							{/if}
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	{#if reactionEntries.length > 0}
		<div class="reactions-bar">
			{#each reactionEntries as entry (entry.emoji)}
				<button
					class="reaction-pill"
					class:reaction-self={entry.hasSelf}
					onclick={() => handleToggleReaction(entry.emoji)}
				>
					<span class="reaction-emoji">
						{#if entry.customUrl}
							<img class="reaction-custom-emoji" src={entry.customUrl} alt={entry.emoji} title={entry.emoji} />
						{:else}
							{entry.emoji}
						{/if}
					</span>
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
{/if}

{#if lightboxUrl}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="lightbox-overlay"
		role="dialog"
		aria-label="Image preview"
		onclick={handleLightboxClick}
		onkeydown={handleLightboxKeydown}
	>
		<button class="lightbox-close" onclick={closeLightbox} aria-label="Close preview">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
				<path d="M18.3 5.7a1 1 0 00-1.4 0L12 10.6 7.1 5.7a1 1 0 00-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 101.4 1.4L12 13.4l4.9 4.9a1 1 0 001.4-1.4L13.4 12l4.9-4.9a1 1 0 000-1.4z"/>
			</svg>
		</button>
		<img class="lightbox-image" src={lightboxUrl} alt="Full size preview" />
	</div>
{/if}

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

	.toolbar-btn-danger {
		color: var(--danger);
	}

	.toolbar-btn-danger:hover {
		background: var(--danger-bg);
		color: var(--danger);
	}

	/* Reply Preview */
	.reply-preview {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 0 4px 0;
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

	/* Media Previews */
	.media-previews {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 6px 0 2px 0;
	}

	.media-thumbnail-btn {
		display: block;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: 4px;
		overflow: hidden;
		max-width: 400px;
	}

	.media-thumbnail-btn:hover {
		opacity: 0.9;
	}

	.media-thumbnail {
		display: block;
		max-width: 400px;
		max-height: 300px;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 4px;
		background: var(--surface-high);
	}

	.media-video {
		display: block;
		max-width: 400px;
		max-height: 300px;
		border-radius: 4px;
		background: var(--surface-lowest);
	}

	.media-audio {
		display: block;
		max-width: 400px;
		width: 100%;
		height: 36px;
		border-radius: 4px;
	}

	/* Lightbox Overlay */
	.lightbox-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.85);
	}

	.lightbox-close {
		position: absolute;
		top: 16px;
		right: 16px;
		padding: 8px;
		border: none;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		cursor: pointer;
		z-index: 1001;
		transition: background var(--duration-message) ease;
	}

	.lightbox-close:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	.lightbox-image {
		max-width: 90vw;
		max-height: 90vh;
		object-fit: contain;
		border-radius: 4px;
	}

	/* ==========================================================================
	   Compact Mode — IRC-inspired high-density layout
	   ========================================================================== */

	.message-compact {
		padding: var(--msg-padding-y, 1px) var(--msg-padding-x, 8px);
		min-height: unset;
		font-size: var(--msg-font-size, 13px);
		line-height: var(--msg-line-height, 1.3);
	}

	.message-compact.message-failed {
		padding-left: var(--msg-padding-x, 8px);
		border-left: 3px solid var(--danger);
	}

	/* Shared grid for compact rows: timestamp | nick | content */
	.compact-row,
	.compact-reply-line,
	.compact-media-row,
	.compact-reactions-row {
		display: grid;
		grid-template-columns: auto var(--nick-width, 120px) 1fr;
		gap: 0 8px;
		align-items: baseline;
	}

	.compact-timestamp {
		font-size: var(--font-xs);
		color: var(--text-muted);
		white-space: nowrap;
		text-align: right;
		user-select: none;
		min-width: 52px;
	}

	.compact-nick {
		font-weight: var(--weight-semibold);
		font-size: var(--msg-font-size, 13px);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.compact-nick:hover {
		text-decoration: underline;
	}

	.compact-text {
		min-width: 0;
	}

	/* Reply preview in compact mode */
	.compact-reply-line {
		padding-bottom: 1px;
	}

	.compact-reply-preview {
		padding: 0;
		gap: 4px;
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

	.reaction-custom-emoji {
		width: 1.2em;
		height: 1.2em;
		object-fit: contain;
		vertical-align: middle;
	}

	/* Inline custom emoji in message text */
	.message-text :global(.custom-emoji) {
		display: inline;
		height: 1.375em;
		width: auto;
		object-fit: contain;
		vertical-align: middle;
		margin: -0.2em 0.05em;
	}
</style>
