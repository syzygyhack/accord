<script lang="ts">
	import { tick, untrack, onMount, onDestroy } from 'svelte';
	import { getMessages, getCursors, historyBatch, type Message, type MessageType } from '$lib/state/messages.svelte';
	import { channelUIState } from '$lib/state/channels.svelte';
	import { getLastReadMsgid } from '$lib/state/notifications.svelte';
	import { themeState } from '$lib/state/theme.svelte';
	import { appSettings } from '$lib/state/appSettings.svelte';
	import { isSystemMessage, summarizeCollapsedGroup, filterSystemMessage } from '$lib/systemMessages';
	import MessageComponent from './Message.svelte';
	import UnreadDivider from './UnreadDivider.svelte';

	interface Props {
		onloadhistory?: (target: string, beforeMsgid: string) => void;
		onreply?: (msgid: string) => void;
		onreact?: (msgid: string, anchor?: { x: number; y: number }) => void;
		onmore?: (msgid: string, event: MouseEvent) => void;
		onpin?: (msgid: string) => void;
		onedit?: (msgid: string) => void;
		oncopytext?: (text: string) => void;
		oncopylink?: (msgid: string) => void;
		onmarkunread?: (msgid: string) => void;
		ontogglereaction?: (msgid: string, emoji: string) => void;
		onretry?: (msgid: string) => void;
		onnickclick?: (nick: string, account: string, event: MouseEvent) => void;
		isOp?: boolean;
	}

	let {
		onloadhistory,
		onreply,
		onreact,
		onmore,
		onpin,
		onedit,
		oncopytext,
		oncopylink,
		onmarkunread,
		ontogglereaction,
		onretry,
		onnickclick,
		isOp = false,
	}: Props = $props();

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

	/** Window for "smart" system message filtering — 15 minutes. */
	const SMART_WINDOW_MS = 15 * 60 * 1000;

	/** How close to the bottom (in px) counts as "at bottom" for auto-scroll. */
	const SCROLL_BOTTOM_THRESHOLD = 48;

	/** How close to the top (in px) triggers history loading. */
	const SCROLL_TOP_THRESHOLD = 200;

	// ── Virtual scrolling constants ──────────────────────────────────────

	/** Maximum render entries in the DOM at once (~50 visible + overscan). */
	const VIRTUAL_WINDOW_SIZE = 50;

	/** Extra entries rendered above/below the visible area to reduce flicker on scroll. */
	const OVERSCAN = 10;

	/** Estimated height (px) for a regular message entry. */
	const EST_MESSAGE_HEIGHT = 60;

	/** Estimated height (px) for a system or collapsed entry. */
	const EST_SYSTEM_HEIGHT = 24;

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

	/** Current system message display preference. */
	let systemDisplay = $derived(appSettings.systemMessageDisplay);

	/**
	 * Set of nicks who sent a privmsg in the last 15 minutes.
	 * Used by 'smart' filtering to decide which join/part/etc. events to show.
	 */
	let recentSpeakers = $derived.by(() => {
		const speakers = new Set<string>();
		if (systemDisplay !== 'smart') return speakers;
		const now = Date.now();
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (now - m.time.getTime() > SMART_WINDOW_MS) break;
			if (m.type === 'privmsg') {
				speakers.add(m.nick);
			}
		}
		return speakers;
	});

	/**
	 * Render entries: regular messages and system messages, with consecutive
	 * system messages collapsed into groups when there are 3+.
	 *
	 * System messages are first filtered by the systemMessageDisplay setting,
	 * then consecutive runs of visible system messages are collapsed.
	 */
	type RenderEntry =
		| { kind: 'message'; message: Message; isGrouped: boolean; isFirstInGroup: boolean }
		| { kind: 'system'; message: Message }
		| { kind: 'collapsed'; messages: Message[]; key: string };

	let renderEntries = $derived.by(() => {
		const result: RenderEntry[] = [];
		const now = new Date();
		let i = 0;

		while (i < messages.length) {
			const msg = messages[i];

			if (isSystemMessage(msg)) {
				// Collect consecutive system messages, applying the display filter
				const visibleRun: Message[] = [];
				let j = i;
				while (j < messages.length && isSystemMessage(messages[j])) {
					if (filterSystemMessage(messages[j], systemDisplay, recentSpeakers)) {
						visibleRun.push(messages[j]);
					}
					j++;
				}

				if (visibleRun.length >= COLLAPSE_THRESHOLD) {
					// Collapse into a group
					const key = visibleRun[0].msgid;
					result.push({ kind: 'collapsed', messages: visibleRun, key });
				} else {
					// Render individually
					for (const sysMsg of visibleRun) {
						result.push({ kind: 'system', message: sysMsg });
					}
				}
				i = j;
			} else {
				// Regular message — compute grouping against previous rendered entry
				const prevEntry = result.length > 0 ? result[result.length - 1] : null;
				let isGrouped = false;
				let isFirstInGroup = true;

				if (prevEntry && prevEntry.kind === 'message') {
					const prev = prevEntry.message;
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

	// ── Virtual scrolling state ──────────────────────────────────────────

	/**
	 * Measured heights for render entries, keyed by entry index.
	 * Updated after each render via measureRenderedItems().
	 */
	let measuredHeights: Map<number, number> = new Map();

	/** Current scroll-top, updated on every scroll event to drive window recalculation. */
	let currentScrollTop = $state(0);

	/** Estimate the height of a render entry at a given index. */
	function estimateHeight(index: number): number {
		const measured = measuredHeights.get(index);
		if (measured !== undefined) return measured;
		const entry = renderEntries[index];
		if (!entry) return EST_MESSAGE_HEIGHT;
		return entry.kind === 'message' ? EST_MESSAGE_HEIGHT : EST_SYSTEM_HEIGHT;
	}

	/**
	 * Prefix-sum cache for cumulative heights.
	 * prefixSums[i] = sum of estimateHeight(0..i-1), so prefixSums[0] = 0.
	 * Invalidated when measuredHeights or renderEntries change.
	 */
	let prefixSums: number[] = [];
	let prefixSumsVersion = 0;
	let lastPrefixVersion = -1;

	function rebuildPrefixSums(): void {
		const total = renderEntries.length;
		prefixSums = new Array(total + 1);
		prefixSums[0] = 0;
		for (let i = 0; i < total; i++) {
			prefixSums[i + 1] = prefixSums[i] + estimateHeight(i);
		}
		lastPrefixVersion = prefixSumsVersion;
	}

	/** Compute the cumulative offset (top of entry at index). Uses prefix-sum cache. */
	function offsetAtIndex(index: number): number {
		if (lastPrefixVersion !== prefixSumsVersion || prefixSums.length !== renderEntries.length + 1) {
			rebuildPrefixSums();
		}
		return prefixSums[index] ?? 0;
	}

	/**
	 * The visible window: which slice of renderEntries to actually render.
	 *
	 * Virtual scrolling strategy:
	 * - If total entries <= VIRTUAL_WINDOW_SIZE, render all (no windowing needed).
	 * - If isAtBottom, always include the tail so new messages appear immediately.
	 * - Otherwise, compute from scroll position using estimated/measured heights.
	 */
	let visibleWindow = $derived.by(() => {
		const total = renderEntries.length;
		if (total <= VIRTUAL_WINDOW_SIZE) {
			return { start: 0, end: total };
		}

		if (isAtBottom) {
			// Anchor to bottom — always render the last VIRTUAL_WINDOW_SIZE entries
			const start = Math.max(0, total - VIRTUAL_WINDOW_SIZE);
			return { start, end: total };
		}

		// Find the first entry whose bottom edge is past scrollTop
		const scrollTop = currentScrollTop;
		const containerHeight = scrollContainer?.clientHeight ?? 800;

		let accumulated = 0;
		let startIdx = 0;
		for (let i = 0; i < total; i++) {
			const h = estimateHeight(i);
			if (accumulated + h > scrollTop) {
				startIdx = i;
				break;
			}
			accumulated += h;
			if (i === total - 1) startIdx = total - 1;
		}

		// Find the last entry visible in the viewport
		let endIdx = startIdx;
		let viewAccumulated = 0;
		for (let i = startIdx; i < total; i++) {
			viewAccumulated += estimateHeight(i);
			endIdx = i + 1;
			if (viewAccumulated >= containerHeight) break;
		}

		// Apply overscan
		const windowStart = Math.max(0, startIdx - OVERSCAN);
		const windowEnd = Math.min(total, endIdx + OVERSCAN);

		return { start: windowStart, end: windowEnd };
	});

	/** The slice of renderEntries actually rendered in the DOM. */
	let visibleEntries = $derived(renderEntries.slice(visibleWindow.start, visibleWindow.end));

	/** Top spacer height — sum of estimated heights for entries above the window. */
	let topSpacerHeight = $derived(offsetAtIndex(visibleWindow.start));

	/** Bottom spacer height — sum of estimated heights for entries below the window. */
	let bottomSpacerHeight = $derived.by(() => {
		const total = renderEntries.length;
		let h = 0;
		for (let i = visibleWindow.end; i < total; i++) {
			h += estimateHeight(i);
		}
		return h;
	});

	/** Ref to the wrapper containing rendered items, used for height measurement. */
	let itemsContainer: HTMLDivElement | undefined = $state(undefined);

	/**
	 * Measure rendered item heights and store them for more accurate positioning.
	 * Called after render via tick().
	 */
	function measureRenderedItems(): void {
		if (!itemsContainer) return;
		const children = itemsContainer.children;
		const startIdx = visibleWindow.start;
		let changed = false;
		for (let i = 0; i < children.length; i++) {
			const el = children[i] as HTMLElement;
			const height = el.getBoundingClientRect().height;
			if (height > 0) {
				const prev = measuredHeights.get(startIdx + i);
				if (prev !== height) {
					measuredHeights.set(startIdx + i, height);
					changed = true;
				}
			}
		}
		if (changed) prefixSumsVersion++;
	}

	/** After each render, measure items for more accurate future estimates. */
	$effect(() => {
		// Subscribe to visibleEntries changes to trigger re-measurement
		void visibleEntries;
		tick().then(measureRenderedItems);
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

	/** RAF guard for scroll throttling. */
	let scrollRafId: number | undefined;

	/** Handle scroll events (throttled via requestAnimationFrame). */
	function handleScroll(): void {
		if (scrollRafId !== undefined) return;
		scrollRafId = requestAnimationFrame(() => {
			scrollRafId = undefined;

			if (scrollContainer) {
				currentScrollTop = scrollContainer.scrollTop;
			}

			checkScrollPosition();

			if (isAtBottom) {
				unreadCount = 0;
			}

			// Trigger history load when near top
			if (scrollContainer && scrollContainer.scrollTop <= SCROLL_TOP_THRESHOLD) {
				loadOlderMessages();
			}
		});
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
				// Messages were prepended (history load) — preserve scroll position.
				// Clear measured heights since prepended entries shift all indices.
				measuredHeights.clear();
				prefixSumsVersion++;
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
		measuredHeights = new Map();
		prefixSumsVersion++;
		currentScrollTop = 0;

		// Show skeleton placeholders if channel has no cached messages yet.
		// Use untrack so this effect only re-runs on channel change, not on
		// every message addition (getMessages reads the reactive version counter).
		const cachedMessages = _channel ? untrack(() => getMessages(_channel)) : [];
		isAwaitingInitialMessages = cachedMessages.length === 0;

		tick().then(() => scrollToBottom());
	});

	/** Listen for external scroll-to-message requests (e.g. from pinned messages). */
	function handleExternalScroll(e: Event): void {
		const msgid = (e as CustomEvent<{ msgid: string }>).detail.msgid;
		handleScrollToMessage(msgid);
	}

	/** Handle keyboard-driven scroll commands (PageUp/Down, Home, End). */
	function handleScrollCommand(e: Event): void {
		if (!scrollContainer) return;
		const action = (e as CustomEvent<{ action: string }>).detail.action;
		const pageAmount = scrollContainer.clientHeight * 0.8;
		switch (action) {
			case 'pageup':
				scrollContainer.scrollTop -= pageAmount;
				break;
			case 'pagedown':
				scrollContainer.scrollTop += pageAmount;
				break;
			case 'home':
				scrollContainer.scrollTop = 0;
				break;
			case 'end':
				scrollToBottom();
				break;
		}
	}

	onMount(() => {
		window.addEventListener('accord:scroll-to-message', handleExternalScroll);
		window.addEventListener('accord:scroll-messages', handleScrollCommand);
	});

	onDestroy(() => {
		window.removeEventListener('accord:scroll-to-message', handleExternalScroll);
		window.removeEventListener('accord:scroll-messages', handleScrollCommand);
		if (scrollRafId !== undefined) cancelAnimationFrame(scrollRafId);
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
		<div class="skeleton-loading" role="status" aria-label="Loading messages">
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
		<div class="skeleton-loading channel-switch-skeleton" role="status" aria-label="Loading messages">
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
		<!-- Virtual scrolling: top spacer maintains scroll position for entries above the window -->
		<div class="virtual-spacer" style="height:{topSpacerHeight}px"></div>

		<!-- Rendered window: only ~VIRTUAL_WINDOW_SIZE entries in the DOM at a time -->
		<div bind:this={itemsContainer}>
			{#each visibleEntries as entry (entry.kind === 'collapsed' ? entry.key : entry.message.msgid)}
				{#if entry.kind === 'collapsed'}
					{#if expandedGroups.has(entry.key)}
						{#each entry.messages as sysMsg (sysMsg.msgid)}
							<div class="system-message" data-msgid={sysMsg.msgid}>
								<span class="system-icon" aria-hidden="true">{systemIcon(sysMsg.type)}</span>
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
							{summarizeCollapsedGroup(entry.messages)} &mdash; click to expand
						</button>
					{/if}
				{:else if entry.kind === 'system'}
					{#if firstUnreadMsgid === entry.message.msgid}
						<UnreadDivider />
					{/if}
					<div class="system-message" data-msgid={entry.message.msgid}>
						<span class="system-icon" aria-hidden="true">{systemIcon(entry.message.type)}</span>
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
							{isOp}
							{onreply}
							{onreact}
							{onmore}
							{onpin}
							{onedit}
							{oncopytext}
							{oncopylink}
							{onmarkunread}
							{ontogglereaction}
							{onretry}
							{onnickclick}
							onscrolltomessage={handleScrollToMessage}
						/>
					</div>
				{/if}
			{/each}
		</div>

		<!-- Virtual scrolling: bottom spacer maintains scroll height for entries below the window -->
		<div class="virtual-spacer" style="height:{bottomSpacerHeight}px"></div>
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

	/* Virtual scrolling spacers — invisible blocks that maintain correct scroll height. */
	.virtual-spacer {
		flex-shrink: 0;
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
		color: var(--text-inverse);
		border-radius: 9px;
		font-size: var(--font-xs);
		font-weight: var(--weight-bold);
		line-height: 1;
	}
</style>
