<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { getMessages, getCursors, historyBatch, type Message, type MessageType } from '$lib/state/messages.svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { getLastReadMsgid } from '$lib/state/notifications.svelte';
	import { themeState } from '$lib/state/theme.svelte';
	import MessageComponent from './Message.svelte';
	import UnreadDivider from './UnreadDivider.svelte';

	interface Props {
		onloadhistory?: (target: string, beforeMsgid: string) => void;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		ontogglereaction?: (msgid: string, emoji: string) => void;
		onretry?: (msgid: string) => void;
	}

	let {
		onloadhistory,
		onreply,
		onreact,
		onmore,
		ontogglereaction,
		onretry,
	}: Props = $props();

	/** System message types. */
	const SYSTEM_TYPES: Set<MessageType> = new Set(['join', 'part', 'quit', 'nick', 'mode']);

	function isSystemMessage(msg: Message): boolean {
		return SYSTEM_TYPES.has(msg.type);
	}

	/** Return the icon for a system message type. */
	function systemIcon(type: MessageType): string {
		switch (type) {
			case 'join': return '\u2192'; // →
			case 'part': return '\u2190'; // ←
			case 'quit': return '\u2190'; // ←
			case 'nick': return '\u2726'; // ✦
			case 'mode': return '\u2699'; // ⚙
			default: return '';
		}
	}

	/** The grouping window in milliseconds (7 minutes). */
	const GROUPING_WINDOW_MS = 7 * 60 * 1000;

	/** Minimum consecutive system messages before collapsing. */
	const COLLAPSE_THRESHOLD = 3;

	/** How close to the bottom (in px) counts as "at bottom" for auto-scroll. */
	const SCROLL_BOTTOM_THRESHOLD = 48;

	/** How close to the top (in px) triggers history loading. */
	const SCROLL_TOP_THRESHOLD = 200;

	let scrollContainer: HTMLDivElement | undefined = $state(undefined);
	let isAtBottom = $state(true);
	let unreadCount = $state(0);
	let isLoadingHistory = $state(false);
	let isAwaitingInitialMessages = $state(false);
	let prevMessageCount = $state(0);
	let prevScrollHeight = $state(0);

	/** Set of collapsed group keys that the user has expanded. */
	let expandedGroups: Set<string> = $state(new Set());

	/** Whether compact (IRC classic) display mode is active. */
	let isCompact = $derived(themeState.isCompact);

	/** Messages for the active channel (shallow copy for Svelte change detection). */
	let messages = $derived.by(() => {
		const ch = channelUIState.activeChannel;
		if (!ch) return [];
		return getMessages(ch).slice();
	});

	/**
	 * The msgid of the first unread message.
	 * Used to position the UnreadDivider.
	 *
	 * The lastReadMsgid may be either a msgid or a timestamp= value from the
	 * server's MARKREAD response. We handle both:
	 * - If it matches a msgid, the divider goes after that message.
	 * - If it looks like a timestamp (ISO 8601), the divider goes after the
	 *   last message with time <= the timestamp.
	 */
	let firstUnreadMsgid = $derived.by(() => {
		if (!channelUIState.activeChannel) return null;
		const lastRead = getLastReadMsgid(channelUIState.activeChannel);
		if (!lastRead) return null;

		// Try matching as a msgid first
		const idx = messages.findIndex((m) => m.msgid === lastRead);
		if (idx !== -1) {
			if (idx >= messages.length - 1) return null;
			return messages[idx + 1].msgid;
		}

		// Try parsing as a timestamp (MARKREAD server responses use timestamp=)
		const ts = new Date(lastRead);
		if (!isNaN(ts.getTime())) {
			for (let i = 0; i < messages.length; i++) {
				if (messages[i].time > ts) {
					return messages[i].msgid;
				}
			}
		}

		return null;
	});

	/**
	 * Render entries: regular messages and system messages, with consecutive
	 * system messages collapsed into groups when there are 3+.
	 */
	type RenderEntry =
		| { kind: 'message'; message: Message; isGrouped: boolean; isFirstInGroup: boolean }
		| { kind: 'system'; message: Message }
		| { kind: 'collapsed'; messages: Message[]; key: string };

	let renderEntries = $derived.by(() => {
		const result: RenderEntry[] = [];
		let i = 0;

		while (i < messages.length) {
			const msg = messages[i];

			if (isSystemMessage(msg)) {
				// Collect consecutive system messages
				const systemRun: Message[] = [msg];
				let j = i + 1;
				while (j < messages.length && isSystemMessage(messages[j])) {
					systemRun.push(messages[j]);
					j++;
				}

				if (systemRun.length >= COLLAPSE_THRESHOLD) {
					// Collapse into a group
					const key = systemRun[0].msgid;
					result.push({ kind: 'collapsed', messages: systemRun, key });
				} else {
					// Render individually
					for (const sysMsg of systemRun) {
						result.push({ kind: 'system', message: sysMsg });
					}
				}
				i = j;
			} else {
				// Regular message — compute grouping
				const prev = i > 0 ? messages[i - 1] : null;
				let isGrouped = false;
				let isFirstInGroup = true;

				if (prev && !isSystemMessage(prev)) {
					const sameAuthor = prev.nick === msg.nick;
					const withinWindow =
						msg.time.getTime() - prev.time.getTime() < GROUPING_WINDOW_MS;
					const isReply = !!msg.replyTo;

					if (sameAuthor && withinWindow && !isReply) {
						isGrouped = true;
						isFirstInGroup = false;
					}
				}

				result.push({ kind: 'message', message: msg, isGrouped, isFirstInGroup });
				i++;
			}
		}

		return result;
	});

	function toggleCollapsedGroup(key: string): void {
		if (expandedGroups.has(key)) {
			expandedGroups.delete(key);
		} else {
			expandedGroups.add(key);
		}
		// Trigger reactivity by reassignment
		expandedGroups = new Set(expandedGroups);
	}

	/** Check if scrolled to bottom. */
	function checkScrollPosition(): void {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		isAtBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
	}

	/** Handle scroll events. */
	function handleScroll(): void {
		checkScrollPosition();

		if (isAtBottom) {
			unreadCount = 0;
		}

		// Trigger history load when near top
		if (scrollContainer && scrollContainer.scrollTop <= SCROLL_TOP_THRESHOLD) {
			loadOlderMessages();
		}
	}

	/** Request older messages via CHATHISTORY BEFORE. */
	function loadOlderMessages(): void {
		if (isLoadingHistory) return;
		if (!channelUIState.activeChannel) return;

		const cursors = getCursors(channelUIState.activeChannel);
		if (!cursors.oldestMsgid) return;

		isLoadingHistory = true;
		prevScrollHeight = scrollContainer?.scrollHeight ?? 0;
		onloadhistory?.(channelUIState.activeChannel, cursors.oldestMsgid);
	}

	/** Scroll to the bottom of the message list. */
	function scrollToBottom(): void {
		if (!scrollContainer) return;
		scrollContainer.scrollTop = scrollContainer.scrollHeight;
		isAtBottom = true;
		unreadCount = 0;
	}

	/** Handle Jump to Present click. */
	function handleJumpToPresent(): void {
		scrollToBottom();
	}

	/** Scroll to a specific message by msgid. */
	function handleScrollToMessage(msgid: string): void {
		if (!scrollContainer) return;
		// Use CSS.escape to prevent selector injection from untrusted msgid values
		const el = scrollContainer.querySelector(`[data-msgid="${CSS.escape(msgid)}"]`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	/**
	 * Effect: react to message count changes.
	 * - Auto-scroll to bottom if we were at bottom and new messages arrive at end.
	 * - Preserve scroll position if messages were prepended (history load).
	 * - Track unread count when scrolled up.
	 */
	$effect(() => {
		const currentCount = messages.length;

		if (currentCount > prevMessageCount) {
			const added = currentCount - prevMessageCount;

			// Clear channel-switch skeleton when first messages arrive
			if (isAwaitingInitialMessages) {
				isAwaitingInitialMessages = false;
			}

			if (isLoadingHistory && scrollContainer) {
				// Messages were prepended (history load) — preserve scroll position
				tick().then(() => {
					if (!scrollContainer) return;
					const newScrollHeight = scrollContainer.scrollHeight;
					const delta = newScrollHeight - prevScrollHeight;
					scrollContainer.scrollTop += delta;
					isLoadingHistory = false;
				});
			} else if (isAtBottom) {
				// New messages at the end — auto-scroll to bottom
				tick().then(() => scrollToBottom());
			} else {
				// Scrolled up — increment unread count
				unreadCount += added;
			}
		}

		prevMessageCount = currentCount;
	});

	/**
	 * Effect: clear loading state when a history batch completes with no messages.
	 * Without this, an empty CHATHISTORY response leaves isLoadingHistory stuck.
	 * Only reacts to batches for the current channel to avoid false clears.
	 */
	$effect(() => {
		// Subscribe to the batch-complete signal
		void historyBatch.seq;
		const batchTarget = historyBatch.target;
		if (isLoadingHistory && batchTarget === channelUIState.activeChannel && messages.length === prevMessageCount) {
			// Batch completed for this channel but no new messages — nothing more to load
			isLoadingHistory = false;
		}
	});

	/** Effect: scroll to bottom when active channel changes. */
	$effect(() => {
		// Access activeChannel to register dependency
		const _channel = channelUIState.activeChannel;

		unreadCount = 0;
		isAtBottom = true;
		isLoadingHistory = false;
		prevMessageCount = 0;
		expandedGroups = new Set();

		// Show skeleton placeholders if channel has no cached messages yet.
		// Use untrack so this effect only re-runs on channel change, not on
		// every message addition (getMessages reads the reactive version counter).
		const cachedMessages = _channel ? untrack(() => getMessages(_channel)) : [];
		isAwaitingInitialMessages = cachedMessages.length === 0;

		tick().then(() => scrollToBottom());
	});
</script>

<div
	class="message-list"
	role="log"
	aria-live="polite"
	bind:this={scrollContainer}
	onscroll={handleScroll}
>
	{#if isLoadingHistory}
		<div class="skeleton-loading">
			<div class="skeleton-row">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-name"></div>
					<div class="skeleton-line skeleton-text"></div>
					<div class="skeleton-line skeleton-text short"></div>
				</div>
			</div>
			<div class="skeleton-row">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-name"></div>
					<div class="skeleton-line skeleton-text"></div>
				</div>
			</div>
		</div>
	{/if}

	{#if isAwaitingInitialMessages}
		<div class="skeleton-loading channel-switch-skeleton">
			<div class="skeleton-row">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-name"></div>
					<div class="skeleton-line skeleton-text"></div>
					<div class="skeleton-line skeleton-text short"></div>
				</div>
			</div>
			<div class="skeleton-row">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-name"></div>
					<div class="skeleton-line skeleton-text"></div>
				</div>
			</div>
			<div class="skeleton-row">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-name"></div>
					<div class="skeleton-line skeleton-text short"></div>
				</div>
			</div>
		</div>
	{:else if messages.length === 0 && !isLoadingHistory}
		<div class="empty-channel">
			<p class="empty-channel-text">
				This is the beginning of {channelUIState.activeChannel ?? 'this channel'}. Say something!
			</p>
		</div>
	{:else}
		{#each renderEntries as entry (entry.kind === 'collapsed' ? entry.key : entry.message.msgid)}
			{#if entry.kind === 'collapsed'}
				{#if expandedGroups.has(entry.key)}
					{#each entry.messages as sysMsg (sysMsg.msgid)}
						<div class="system-message" data-msgid={sysMsg.msgid}>
							<span class="system-icon">{systemIcon(sysMsg.type)}</span>
							<span class="system-text">{sysMsg.text}</span>
						</div>
					{/each}
					<button class="collapse-toggle" onclick={() => toggleCollapsedGroup(entry.key)}>
						Collapse
					</button>
				{:else}
					<button
						class="collapse-toggle"
						onclick={() => toggleCollapsedGroup(entry.key)}
					>
						{entry.messages.length} events &mdash; click to expand
					</button>
				{/if}
			{:else if entry.kind === 'system'}
				{#if firstUnreadMsgid === entry.message.msgid}
					<UnreadDivider />
				{/if}
				<div class="system-message" data-msgid={entry.message.msgid}>
					<span class="system-icon">{systemIcon(entry.message.type)}</span>
					<span class="system-text">{entry.message.text}</span>
				</div>
			{:else}
				{#if firstUnreadMsgid === entry.message.msgid}
					<UnreadDivider />
				{/if}
				<div data-msgid={entry.message.msgid}>
					<MessageComponent
						message={entry.message}
						isGrouped={entry.isGrouped}
						isFirstInGroup={entry.isFirstInGroup}
						compact={isCompact}
						{onreply}
						{onreact}
						{onmore}
						{ontogglereaction}
						{onretry}
						onscrolltomessage={handleScrollToMessage}
					/>
				</div>
			{/if}
		{/each}
	{/if}
</div>

{#if !isAtBottom}
	<button class="jump-to-present" onclick={handleJumpToPresent}>
		{#if unreadCount > 0}
			<span class="unread-badge">{unreadCount}</span>
		{/if}
		Jump to Present
		<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
			<path d="M7 10.5L2.5 6h9L7 10.5z"/>
		</svg>
	</button>
{/if}

<style>
	.message-list {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		display: flex;
		flex-direction: column;
		padding: 16px 0 8px;
		position: relative;
		/* Limit layout recalculation scope — the message list doesn't affect
		   sibling layout, so the browser can skip reflowing the rest of the page. */
		contain: strict;
	}

	/* Skeleton loading for history fetch */
	.skeleton-loading {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px 72px 16px 72px;
	}

	.skeleton-row {
		display: flex;
		gap: 16px;
	}

	.skeleton-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-high);
		flex-shrink: 0;
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}

	.skeleton-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.skeleton-line {
		height: 12px;
		border-radius: 6px;
		background: var(--surface-high);
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}

	.skeleton-name {
		width: 100px;
		height: 14px;
	}

	.skeleton-text {
		width: 80%;
	}

	.skeleton-text.short {
		width: 50%;
	}

	@keyframes skeleton-pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.8; }
	}

	/* Empty channel state */
	.empty-channel {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
	}

	.empty-channel-text {
		color: var(--text-muted);
		font-size: var(--font-md);
		text-align: center;
		margin: 0;
	}

	/* System messages (join/part/quit/nick/mode) */
	.system-message {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 72px;
		font-size: var(--font-sm);
		color: var(--text-muted);
	}

	.system-icon {
		flex-shrink: 0;
		font-size: var(--font-sm);
		line-height: 1;
	}

	.system-text {
		line-height: 1.375;
	}

	/* Collapsed system message group toggle */
	.collapse-toggle {
		display: block;
		margin: 2px 72px;
		padding: 2px 8px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--text-muted);
		font-size: var(--font-xs);
		font-family: var(--font-primary);
		cursor: pointer;
		transition: background var(--duration-message) ease;
	}

	.collapse-toggle:hover {
		background: var(--surface-high);
		color: var(--text-secondary);
	}

	/* Jump to Present pill */
	.jump-to-present {
		position: absolute;
		bottom: 8px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
		background: var(--accent-primary);
		color: var(--text-inverse);
		border: none;
		border-radius: 20px;
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		font-family: var(--font-primary);
		cursor: pointer;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.32);
		z-index: 20;
		transition:
			background var(--duration-message) ease,
			box-shadow var(--duration-message) ease;
	}

	.jump-to-present:hover {
		background: var(--accent-secondary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.unread-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		background: var(--danger);
		color: #fff;
		border-radius: 9px;
		font-size: var(--font-xs);
		font-weight: var(--weight-bold);
		line-height: 1;
	}
</style>
