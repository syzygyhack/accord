<script lang="ts">
	import { renderMessage, nickColor } from '$lib/irc/format';
	import { getMessage, isPinned } from '$lib/state/messages.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { appSettings } from '$lib/state/appSettings.svelte';
	import { themeState } from '$lib/state/theme.svelte';
	import { extractMediaUrls } from '$lib/media';
	import { getCustomEmojiUrl } from '$lib/emoji';
	import { extractPreviewUrl, fetchPreview, getCachedPreview, type LinkPreview } from '$lib/files/preview';
	import { getToken } from '$lib/api/auth';
	import { getMember } from '$lib/state/members.svelte';
	import { getRoleColor } from '$lib/state/serverConfig.svelte';
	import type { Message } from '$lib/state/messages.svelte';

	interface Props {
		message: Message;
		isGrouped: boolean;
		isFirstInGroup: boolean;
		compact?: boolean;
		isOp?: boolean;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string, anchor?: { x: number; y: number }) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		onpin?: (msgid: string) => void;
		onedit?: (msgid: string) => void;
		oncopytext?: (text: string) => void;
		oncopylink?: (msgid: string) => void;
		onmarkunread?: (msgid: string) => void;
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
		isOp = false,
		onreply,
		onreact,
		onmore,
		onpin,
		onedit,
		oncopytext,
		oncopylink,
		onmarkunread,
		ontogglereaction,
		onscrolltomessage,
		onretry,
		onnickclick,
	}: Props = $props();

	let isFailed = $derived(message.sendState === 'failed');
	let isSending = $derived(message.sendState === 'sending');
	/** Messages with local-only msgids can't be redacted on the server. */
	let canDelete = $derived(!message.msgid.startsWith('_local_'));
	/** Whether this message was sent by the current user. */
	let isOwnMessage = $derived(message.account === (userState.account ?? ''));
	let devTooltip = $derived(appSettings.developerMode ? `msgid: ${message.msgid}` : undefined);

	function handleRetry() {
		onretry?.(message.msgid);
	}

	let hovered = $state(false);
	let moreMenuOpen = $state(false);

	let pinned = $derived(isPinned(message.target, message.msgid));

	let color = $derived.by(() => {
		// Role color takes priority over hash-based nick coloring (highest-ranked role wins)
		const member = getMember(message.target, message.nick);
		if (member?.highestMode) {
			const roleColor = getRoleColor(member.highestMode);
			if (roleColor) return roleColor;
		}
		return nickColor(message.account, themeState.current);
	});

	/** Whether this message mentions the current user via @nick. */
	let isMention = $derived.by(() => {
		const myAccount = userState.account;
		if (!myAccount || message.isRedacted) return false;
		const pattern = new RegExp(`@${myAccount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		return pattern.test(message.text);
	});

	let mediaUrls = $derived.by(() => {
		if (message.isRedacted) return [];
		return extractMediaUrls(message.text);
	});

	/** Strip embedded media URLs from the displayed text so only the inline previews show. */
	let renderedText = $derived.by(() => {
		if (message.isRedacted) return '';
		let text = message.text;
		if (mediaUrls.length > 0) {
			for (const media of mediaUrls) {
				text = text.replace(media.url, '').trim();
			}
		}
		return renderMessage(text, userState.account ?? '');
	});

	/** True when the message is only media URLs with no surrounding text. */
	let isMediaOnly = $derived(mediaUrls.length > 0 && renderedText.replace(/<[^>]*>/g, '').trim() === '');

	let previewUrl = $derived.by(() => {
		if (message.isRedacted) return null;
		return extractPreviewUrl(message.text);
	});

	let linkPreview = $state<LinkPreview | null>(null);
	let previewLoading = $state(false);

	$effect(() => {
		const url = previewUrl;
		if (!url) {
			linkPreview = null;
			previewLoading = false;
			return;
		}

		// Check cache first (synchronous)
		const cached = getCachedPreview(url);
		if (cached !== undefined) {
			linkPreview = cached;
			previewLoading = false;
			return;
		}

		const token = getToken();
		const filesUrl = typeof localStorage !== 'undefined'
			? localStorage.getItem('virc:filesUrl')
			: null;

		if (!token || !filesUrl) {
			linkPreview = null;
			previewLoading = false;
			return;
		}

		// Track staleness: if previewUrl changes before fetch completes,
		// discard the result to avoid showing data for a different URL.
		let stale = false;
		previewLoading = true;
		fetchPreview(url, token, filesUrl).then((result) => {
			if (stale) return;
			linkPreview = result;
			previewLoading = false;
		}).catch(() => {
			if (stale) return;
			linkPreview = null;
			previewLoading = false;
		});

		return () => { stale = true; };
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

	/** Open emoji picker anchored to the '+' button in the reaction bar. */
	function handleReactionBarAdd(event: MouseEvent) {
		const btn = event.currentTarget as HTMLElement;
		const rect = btn.getBoundingClientRect();
		onreact?.(message.msgid, { x: rect.left, y: rect.top });
	}

	function handleMore(event: MouseEvent) {
		onmore?.(message.msgid, event);
		moreMenuOpen = false;
	}

	function handlePin() {
		onpin?.(message.msgid);
		moreMenuOpen = false;
	}

	let moreMenuWrapper: HTMLDivElement | undefined = $state();

	function toggleMoreMenu() {
		moreMenuOpen = !moreMenuOpen;
	}

	function closeMoreMenu() {
		moreMenuOpen = false;
	}

	// Close more-menu on click outside
	$effect(() => {
		if (!moreMenuOpen) return;
		function handleClickOutside(e: MouseEvent) {
			if (moreMenuWrapper && !moreMenuWrapper.contains(e.target as Node)) {
				moreMenuOpen = false;
			}
		}
		// Delay to avoid catching the opening click
		const rafId = requestAnimationFrame(() => {
			window.addEventListener('click', handleClickOutside, { capture: true });
		});
		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener('click', handleClickOutside, { capture: true });
		};
	});

	function handleToggleReaction(emoji: string) {
		ontogglereaction?.(message.msgid, emoji);
	}

	function handleScrollToParent() {
		if (message.replyTo) {
			onscrolltomessage?.(message.replyTo);
		}
	}

	function handleEdit() {
		onedit?.(message.msgid);
		moreMenuOpen = false;
	}

	function handleCopyText() {
		oncopytext?.(message.text);
		moreMenuOpen = false;
	}

	function handleCopyLink() {
		oncopylink?.(message.msgid);
		moreMenuOpen = false;
	}

	function handleMarkUnread() {
		onmarkunread?.(message.msgid);
		moreMenuOpen = false;
	}

	/** Toggle spoiler reveal when clicking a .spoiler element inside message text. */
	function handleMessageTextClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (target.classList.contains('spoiler')) {
			target.classList.toggle('spoiler-revealed');
		}
	}

	/** Open profile popout when clicking a nick in a message. */
	function handleNickClick(event: MouseEvent) {
		onnickclick?.(message.nick, message.account, event);
	}
</script>

<!-- ===== Shared template snippets ===== -->

{#snippet hoverToolbar()}
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
			<div class="toolbar-more-wrapper" bind:this={moreMenuWrapper}>
				<button class="toolbar-btn" title="More" aria-label="More actions" onclick={toggleMoreMenu}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<circle cx="3" cy="8" r="1.5"/>
						<circle cx="8" cy="8" r="1.5"/>
						<circle cx="13" cy="8" r="1.5"/>
					</svg>
				</button>
				{#if moreMenuOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="more-menu">
						{#if isOwnMessage}
							<button class="more-menu-item" onclick={handleEdit}>
								Edit Message
							</button>
						{/if}
						<button class="more-menu-item" onclick={handleCopyText}>
							Copy Text
						</button>
						<button class="more-menu-item" onclick={handleCopyLink}>
							Copy Link
						</button>
						<button class="more-menu-item" onclick={handleMarkUnread}>
							Mark Unread
						</button>
						{#if isOp}
							<button class="more-menu-item" onclick={handlePin}>
								{pinned ? 'Unpin Message' : 'Pin Message'}
							</button>
						{/if}
						{#if canDelete}
							<button class="more-menu-item more-menu-item-danger" onclick={(e) => handleMore(e)}>
								Delete Message
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet mediaPreviews()}
	{#if mediaUrls.length > 0}
		<div class="media-previews">
			{#each mediaUrls as media (media.url)}
				{#if media.type === 'image'}
					<button class="media-thumbnail-btn" onclick={() => openLightbox(media.url)}>
						<div class="media-thumbnail-placeholder">
							<img
								class="media-thumbnail"
								src={media.url}
								alt="Image preview"
								loading="lazy"
								onload={(e) => (e.currentTarget as HTMLImageElement).dataset.loaded = ''}
							/>
						</div>
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
{/snippet}

{#snippet linkPreviewCard()}
	{#if linkPreview || previewLoading}
		{#if previewLoading}
			<div class="link-preview-card link-preview-skeleton">
				<div class="skeleton-line skeleton-site-name"></div>
				<div class="skeleton-line skeleton-title"></div>
				<div class="skeleton-line skeleton-desc"></div>
			</div>
		{:else if linkPreview}
			<a class="link-preview-card" href={linkPreview.url} target="_blank" rel="noopener noreferrer">
				<div class="link-preview-text">
					{#if linkPreview.siteName}
						<span class="link-preview-site">{linkPreview.siteName}</span>
					{/if}
					{#if linkPreview.title}
						<span class="link-preview-title">{linkPreview.title}</span>
					{/if}
					{#if linkPreview.description}
						<span class="link-preview-desc">{linkPreview.description}</span>
					{/if}
				</div>
				{#if linkPreview.image}
					<img class="link-preview-thumb" src={linkPreview.image} alt="" loading="lazy" />
				{/if}
			</a>
		{/if}
	{/if}
{/snippet}

{#snippet reactionsBar()}
	{#if reactionEntries.length > 0}
		<div class="reactions-bar" class:reactions-bar-overflow={reactionEntries.length > 20}>
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
			<button
				class="reaction-pill reaction-add"
				title="Add Reaction"
				aria-label="Add Reaction"
				onclick={handleReactionBarAdd}
			>
				<span class="reaction-add-icon">+</span>
			</button>
		</div>
	{/if}
{/snippet}

{#snippet sendFailed()}
	{#if isFailed}
		<div class="send-failed">
			<svg class="send-failed-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
				<path d="M7 0a7 7 0 110 14A7 7 0 017 0zm0 9.8a.9.9 0 100 1.8.9.9 0 000-1.8zM7.7 3.5H6.3l.2 5h1l.2-5z"/>
			</svg>
			<span class="send-failed-text">Failed to send</span>
			<button class="send-failed-retry" onclick={handleRetry}>Retry</button>
		</div>
	{/if}
{/snippet}

{#snippet messageContent()}
	{#if message.isRedacted}
		<div class="message-text redacted">[message deleted]</div>
	{:else}
		{#if !isMediaOnly}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="message-text" onclick={handleMessageTextClick}>{@html renderedText}</div>
		{/if}
		{@render mediaPreviews()}
		{@render linkPreviewCard()}
	{/if}
{/snippet}

<!-- ===== Compact mode ===== -->

{#if compact}
<div
	class="message message-compact"
	class:message-redacted={message.isRedacted}
	class:message-failed={isFailed}
	class:message-sending={isSending}
	class:message-mention={isMention}
	role="article"
	title={devTooltip}
	aria-label="{message.nick}: {message.isRedacted ? 'message deleted' : message.text.slice(0, 100)}"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
	onfocusin={() => (hovered = true)}
	onfocusout={() => (hovered = false)}
>
	{@render hoverToolbar()}

	{#if replyParent}
		<div class="compact-reply-line">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			<div class="reply-preview compact-reply-preview" role="button" tabindex="0" onclick={handleScrollToParent} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleScrollToParent(); } }}>
				<svg class="reply-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
					<path d="M5 2.3L1 5.6a.4.4 0 000 .6L5 9.5a.4.4 0 00.6-.3V7.5c2.2 0 4 .6 5.2 2.7.2.3.5.3.5-.1C11.3 6.8 9 4.1 5.6 3.9V2.6a.4.4 0 00-.6-.3z"/>
				</svg>
				<span class="reply-nick" style="color: {nickColor(replyParent.account, themeState.current)}">
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
			{:else if !isMediaOnly}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="message-text" onclick={handleMessageTextClick}>{@html renderedText}</span>
			{/if}
		</div>
	</div>

	{#if !message.isRedacted && mediaUrls.length > 0}
		<div class="compact-media-row">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			{@render mediaPreviews()}
		</div>
	{/if}

	{#if !message.isRedacted && (linkPreview || previewLoading)}
		<div class="compact-media-row">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			{@render linkPreviewCard()}
		</div>
	{/if}

	{#if reactionEntries.length > 0}
		<div class="compact-reactions-row">
			<span class="compact-timestamp"></span>
			<span class="compact-nick"></span>
			{@render reactionsBar()}
		</div>
	{/if}

	{@render sendFailed()}
</div>

<!-- ===== Cozy mode ===== -->

{:else}
<div
	class="message"
	class:message-grouped={isGrouped && !isFirstInGroup}
	class:message-redacted={message.isRedacted}
	class:message-failed={isFailed}
	class:message-sending={isSending}
	class:message-mention={isMention}
	role="article"
	title={devTooltip}
	aria-label="{message.nick}: {message.isRedacted ? 'message deleted' : message.text.slice(0, 100)}"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
	onfocusin={() => (hovered = true)}
	onfocusout={() => (hovered = false)}
>
	{@render hoverToolbar()}

	{#if isFirstInGroup || !isGrouped}
		{#if replyParent}
				<div class="reply-preview" role="button" tabindex="0" onclick={handleScrollToParent} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleScrollToParent(); } }}>
				<svg class="reply-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
					<path d="M5 2.3L1 5.6a.4.4 0 000 .6L5 9.5a.4.4 0 00.6-.3V7.5c2.2 0 4 .6 5.2 2.7.2.3.5.3.5-.1C11.3 6.8 9 4.1 5.6 3.9V2.6a.4.4 0 00-.6-.3z"/>
				</svg>
				<span class="reply-nick" style="color: {nickColor(replyParent.account, themeState.current)}">
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
				{@render messageContent()}
			</div>
		</div>
	{:else}
		<div class="message-grouped-row">
			<span class="timestamp-gutter" class:visible={hovered}>
				{timestamp}
			</span>
			{@render messageContent()}
		</div>
	{/if}

	{@render reactionsBar()}
	{@render sendFailed()}
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

	.message-mention {
		background: var(--msg-mention-bg);
		border-left: 3px solid var(--msg-mention-border);
	}

	.message-mention:not(.message-compact) {
		padding-left: 69px;
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

	/* More menu dropdown */
	.toolbar-more-wrapper {
		position: relative;
	}

	.more-menu {
		position: absolute;
		top: 100%;
		right: 0;
		min-width: 160px;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		z-index: 20;
		padding: 4px 0;
	}

	.more-menu-item {
		display: block;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
	}

	.more-menu-item:hover {
		background: var(--surface-high);
	}

	.more-menu-item-danger {
		color: var(--danger);
	}

	.more-menu-item-danger:hover {
		background: var(--danger-bg);
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

	/* Fenced code blocks with syntax highlighting */
	.message-text :global(.code-block) {
		margin: 4px 0;
		padding: 8px 12px;
		background: var(--surface-lowest);
		border: 1px solid var(--surface-highest);
		border-radius: 4px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--font-sm);
		line-height: 1.45;
	}

	.message-text :global(.code-block code) {
		padding: 0;
		background: transparent;
		border-radius: 0;
	}

	.message-text :global(.hljs-keyword) {
		color: #c678dd;
		font-weight: var(--weight-medium);
	}

	.message-text :global(.hljs-literal) {
		color: #d19a66;
	}

	.message-text :global(.hljs-string) {
		color: #98c379;
	}

	.message-text :global(.hljs-number) {
		color: #d19a66;
	}

	.message-text :global(.hljs-comment) {
		color: #5c6370;
		font-style: italic;
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

	/* Spoiler text — blurred until clicked */
	.message-text :global(.spoiler) {
		background: var(--surface-highest);
		border-radius: 3px;
		padding: 0 2px;
		cursor: pointer;
		filter: blur(4px);
		-webkit-filter: blur(4px);
		transition: filter 0.2s ease, -webkit-filter 0.2s ease;
		user-select: none;
	}

	.message-text :global(.spoiler.spoiler-revealed) {
		filter: none;
		-webkit-filter: none;
		cursor: text;
		user-select: auto;
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

	.media-thumbnail-placeholder {
		max-width: 400px;
		aspect-ratio: 16 / 9;
		background: var(--surface-high);
		border-radius: 4px;
		overflow: hidden;
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
		filter: blur(10px);
		transition: filter 0.3s ease;
	}

	.media-thumbnail[data-loaded] {
		filter: none;
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
		color: var(--text-inverse);
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

	.reactions-bar-overflow {
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: thin;
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

	.reaction-add {
		border-style: dashed;
		background: transparent;
		color: var(--interactive-normal);
		flex-shrink: 0;
	}

	.reaction-add:hover {
		background: var(--surface-highest);
		border-color: var(--interactive-muted);
		color: var(--interactive-hover);
	}

	.reaction-add-icon {
		font-size: var(--font-base);
		font-weight: var(--weight-semibold);
		line-height: 1;
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

	/* Link Preview Card */
	.link-preview-card {
		display: flex;
		gap: 12px;
		max-width: 400px;
		margin-top: 6px;
		padding: 10px 12px;
		border: 1px solid var(--surface-highest);
		border-left: 3px solid var(--accent-primary);
		border-radius: 4px;
		background: var(--surface-high);
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		transition: background var(--duration-message) ease;
	}

	a.link-preview-card:hover {
		background: var(--surface-highest);
	}

	.link-preview-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.link-preview-site {
		font-size: var(--font-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.link-preview-title {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-link);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.link-preview-desc {
		font-size: var(--font-xs);
		color: var(--text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.4;
	}

	.link-preview-thumb {
		flex-shrink: 0;
		width: 60px;
		height: 60px;
		object-fit: cover;
		border-radius: 4px;
		background: var(--surface-lowest);
	}

	/* Link preview skeleton loading state */
	.link-preview-skeleton {
		flex-direction: column;
	}

	.link-preview-skeleton .skeleton-line {
		height: 10px;
		border-radius: 4px;
		background: var(--surface-highest);
		animation: link-preview-pulse 1.5s ease-in-out infinite;
	}

	.link-preview-skeleton .skeleton-site-name {
		width: 60px;
		height: 8px;
		margin-bottom: 2px;
	}

	.link-preview-skeleton .skeleton-title {
		width: 75%;
		height: 12px;
	}

	.link-preview-skeleton .skeleton-desc {
		width: 90%;
	}

	@keyframes link-preview-pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.8; }
	}
</style>
