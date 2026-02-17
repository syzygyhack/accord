<script lang="ts">
	import { channelUIState, getChannel, isDMTarget } from '$lib/state/channels.svelte';
	import { getMember } from '$lib/state/members.svelte';
	import { getPinnedMessages, getMessage } from '$lib/state/messages.svelte';
	import type { Message } from '$lib/state/messages.svelte';
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';
	import { userState } from '$lib/state/user.svelte';
	import { voiceState } from '$lib/state/voice.svelte';

	interface Props {
		ontogglemembers?: () => void;
		membersVisible?: boolean;
		ontopicedit?: (channel: string, newTopic: string) => void;
		ontogglesidebar?: () => void;
		showSidebarToggle?: boolean;
		onvoicecall?: (target: string) => void;
		onvideocall?: (target: string) => void;
		onscrolltomessage?: (msgid: string) => void;
		ontogglesearch?: () => void;
		searchVisible?: boolean;
		onopenserversettings?: () => void;
	}

	let { ontogglemembers, membersVisible = false, ontopicedit, ontogglesidebar, showSidebarToggle = false, onvoicecall, onvideocall, onscrolltomessage, ontogglesearch, searchVisible = false, onopenserversettings }: Props = $props();

	let channelInfo = $derived(
		channelUIState.activeChannel
			? getChannel(channelUIState.activeChannel)
			: null
	);

	let isDM = $derived(
		channelUIState.activeChannel
			? isDMTarget(channelUIState.activeChannel)
			: false
	);

	let isInDMCall = $derived(
		isDM && voiceState.isConnected && voiceState.currentRoom?.startsWith('dm:')
	);

	let isVoice = $derived.by(() => {
		if (!channelUIState.activeChannel) return false;
		return channelUIState.categories.some(
			(cat) => cat.voice && cat.channels.includes(channelUIState.activeChannel!)
		);
	});

	/** Whether the current user has op (@) or higher in the active channel. */
	let isOp = $derived.by(() => {
		if (!channelUIState.activeChannel || !userState.nick) return false;
		const member = getMember(channelUIState.activeChannel, userState.nick);
		if (!member || !member.highestMode) return false;
		// ~, &, @ are op-level or higher
		return ['~', '&', '@'].includes(member.highestMode);
	});

	let topicExpanded = $state(false);
	let topicEditing = $state(false);
	let editValue = $state('');
	let showPinnedDropdown = $state(false);
	let pinWrapper: HTMLDivElement | undefined = $state();

	// Close pinned dropdown on click outside
	$effect(() => {
		if (!showPinnedDropdown) return;
		function handleClickOutside(e: MouseEvent) {
			if (pinWrapper && !pinWrapper.contains(e.target as Node)) {
				showPinnedDropdown = false;
			}
		}
		const rafId = requestAnimationFrame(() => {
			window.addEventListener('click', handleClickOutside, { capture: true });
		});
		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener('click', handleClickOutside, { capture: true });
		};
	});

	/** Pinned message IDs for the active channel. */
	let pinnedMsgids = $derived(
		channelUIState.activeChannel
			? getPinnedMessages(channelUIState.activeChannel)
			: new Set<string>()
	);

	/** Resolve pinned IDs to full Message objects (skips deleted/missing). */
	let pinnedMessagesList = $derived.by((): Message[] => {
		if (!channelUIState.activeChannel || pinnedMsgids.size === 0) return [];
		const result: Message[] = [];
		for (const msgid of pinnedMsgids) {
			const msg = getMessage(channelUIState.activeChannel, msgid);
			if (msg) result.push(msg);
		}
		return result;
	});

	function togglePinnedDropdown(): void {
		showPinnedDropdown = !showPinnedDropdown;
	}

	function handlePinnedMessageClick(msgid: string): void {
		showPinnedDropdown = false;
		onscrolltomessage?.(msgid);
	}

	function handleTopicClick(): void {
		if (isOp) {
			// Enter edit mode
			topicEditing = true;
			editValue = channelInfo?.topic ?? '';
		} else {
			// Toggle expanded
			topicExpanded = !topicExpanded;
		}
	}

	function handleEditKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (ontopicedit && channelUIState.activeChannel) {
				ontopicedit(channelUIState.activeChannel, editValue);
			}
			topicEditing = false;
		} else if (e.key === 'Escape') {
			e.preventDefault();
			topicEditing = false;
		}
	}

	function handleEditBlur(): void {
		topicEditing = false;
	}
</script>

<header class="header-bar">
	{#if showSidebarToggle}
		<button
			class="action-button hamburger-button"
			title="Toggle Sidebar"
			aria-label="Toggle Sidebar"
			onclick={ontogglesidebar}
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>
	{/if}

	<div class="channel-info">
		{#if channelUIState.activeChannel}
			<span class="channel-label">
				{#if isDM}
					<span class="hash">@</span>
				{:else if isVoice}
					<svg class="channel-type-icon" width="16" height="16" viewBox="0 0 16 16">
						<path
							d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 8a1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V14H5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9v-1.1A5 5 0 0 0 13 8a1 1 0 0 0-2 0 3 3 0 0 1-6 0z"
							fill="currentColor"
						/>
					</svg>
				{:else}
					<span class="hash">#</span>
				{/if}
				<span class="channel-name">{isDM ? channelUIState.activeChannel : channelUIState.activeChannel.replace(/^#/, '')}</span>
			</span>

			{#if !isDM}
				{#if topicEditing}
					<span class="divider"></span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="topic-edit"
						type="text"
						bind:value={editValue}
						onkeydown={handleEditKeydown}
						onblur={handleEditBlur}
						autofocus
					/>
				{:else if channelInfo?.topic}
					<span class="divider"></span>
					<span
						class="topic"
						class:topic-expanded={topicExpanded}
						class:topic-editable={isOp}
						title={topicExpanded ? undefined : channelInfo.topic}
						role="button"
						tabindex="0"
						onclick={handleTopicClick}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTopicClick(); } }}
					>{channelInfo.topic}</span>
				{/if}
			{/if}
		{/if}
	</div>

	<div class="actions">
		{#if isDM && channelUIState.activeChannel}
			<button
				class="action-button"
				class:active={isInDMCall}
				title={isInDMCall ? 'End Call' : 'Start Voice Call'}
				aria-label={isInDMCall ? 'End Call' : 'Start Voice Call'}
				onclick={() => onvoicecall?.(channelUIState.activeChannel!)}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"
						fill="currentColor"
					/>
					{#if isInDMCall}
						<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
					{/if}
				</svg>
			</button>
			<button
				class="action-button"
				class:active={isInDMCall && voiceState.localVideoEnabled}
				title={isInDMCall ? 'Toggle Video' : 'Start Video Call'}
				aria-label={isInDMCall ? 'Toggle Video' : 'Start Video Call'}
				onclick={() => onvideocall?.(channelUIState.activeChannel!)}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M15 8v8H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zm6-1.8L17 9v6l4 2.8V6.2z"
						fill="currentColor"
					/>
					{#if isInDMCall && !voiceState.localVideoEnabled}
						<line x1="3" y1="3" x2="21" y2="21" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" />
					{/if}
				</svg>
			</button>
		{/if}
		<div class="pin-wrapper" bind:this={pinWrapper}>
			<button
				class="action-button"
				class:active={showPinnedDropdown}
				title="Pinned Messages"
				aria-label="Pinned Messages"
				onclick={togglePinnedDropdown}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5a3 3 0 0 1-3 3v2h5.97v7l1 1 1-1v-7H19v-2a3 3 0 0 1-3-3z"
						fill="currentColor"
					/>
				</svg>
				{#if pinnedMsgids.size > 0}
					<span class="pin-badge">{pinnedMsgids.size}</span>
				{/if}
			</button>
			{#if showPinnedDropdown}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="pinned-dropdown">
					<div class="pinned-header">Pinned Messages</div>
					{#if pinnedMessagesList.length === 0}
						<div class="pinned-empty">No pinned messages in this channel.</div>
					{:else}
						{#each pinnedMessagesList as msg (msg.msgid)}
							<button class="pinned-item" onclick={() => handlePinnedMessageClick(msg.msgid)}>
								<span class="pinned-nick" style="color: {nickColor(msg.account, themeState.current)}">{msg.nick}</span>
								<span class="pinned-text">{msg.text.length > 80 ? msg.text.slice(0, 80) + '...' : msg.text}</span>
								<span class="pinned-time">{msg.time.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
		<button
			class="action-button"
			class:active={searchVisible}
			title="Search Messages"
			aria-label="Search Messages"
			onclick={ontogglesearch}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
				<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
				<path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
		<button
			class="action-button"
			class:active={membersVisible}
			title="Toggle Member List"
			aria-label="Toggle Member List"
			onclick={ontogglemembers}
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path
					d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2.33 0-7 1.17-7 3.5V14h14v-1.5C13 10.17 8.33 9 6 9zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 1c-1.01 0-2.13.25-3 .68 1.1.73 1.88 1.75 1.88 2.82V14H18v-1.5c0-2.01-3.67-3.5-3-3.5z"
					fill="currentColor"
				/>
			</svg>
		</button>
		{#if isOp && !isDM}
			<button
				class="action-button"
				title="Channel Settings"
				aria-label="Channel Settings"
				onclick={onopenserversettings}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
					<path
						d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
						fill="currentColor"
					/>
				</svg>
			</button>
		{/if}
	</div>
</header>

<style>
	.header-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 16px;
		background: var(--surface-base);
		border-bottom: 1px solid var(--surface-low);
		flex-shrink: 0;
	}

	.channel-info {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}

	.channel-label {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.hash {
		color: var(--text-muted);
		font-size: var(--font-lg);
		font-weight: var(--weight-medium);
		line-height: 1;
	}

	.channel-type-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.channel-name {
		font-size: var(--font-md);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
		white-space: nowrap;
	}

	.divider {
		width: 1px;
		height: 20px;
		background: var(--surface-highest);
		flex-shrink: 0;
	}

	.topic {
		font-size: var(--font-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		cursor: pointer;
	}

	.topic.topic-expanded {
		white-space: normal;
		overflow: visible;
		text-overflow: unset;
	}

	.topic.topic-editable {
		cursor: text;
	}

	.topic-edit {
		font-size: var(--font-sm);
		color: var(--text-primary);
		background: var(--surface-high);
		border: 1px solid var(--accent-primary);
		border-radius: 4px;
		padding: 2px 6px;
		min-width: 0;
		flex: 1;
		font-family: inherit;
		outline: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		margin-left: 8px;
	}

	.action-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--interactive-normal);
		transition:
			color var(--duration-channel),
			background var(--duration-channel);
	}

	.action-button:hover:not(:disabled) {
		color: var(--interactive-hover);
		background: var(--surface-high);
	}

	.action-button.active {
		color: var(--interactive-active);
		background: var(--surface-high);
	}

	.hamburger-button {
		flex-shrink: 0;
		margin-right: 8px;
	}

	/* Pinned messages */
	.pin-wrapper {
		position: relative;
	}

	.pin-badge {
		position: absolute;
		top: 2px;
		right: 2px;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		background: var(--danger);
		color: var(--text-inverse);
		border-radius: 7px;
		font-size: 10px;
		font-weight: var(--weight-bold);
		line-height: 14px;
		text-align: center;
		pointer-events: none;
	}

	.pinned-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		width: 360px;
		max-height: 400px;
		overflow-y: auto;
		background: var(--surface-low);
		border: 1px solid var(--surface-highest);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.pinned-header {
		padding: 12px 16px 8px;
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
		border-bottom: 1px solid var(--surface-highest);
	}

	.pinned-empty {
		padding: 24px 16px;
		font-size: var(--font-sm);
		color: var(--text-muted);
		text-align: center;
	}

	.pinned-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 16px;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-primary);
		transition: background var(--duration-channel);
	}

	.pinned-item:hover {
		background: var(--surface-high);
	}

	.pinned-nick {
		font-size: var(--font-sm);
		font-weight: var(--weight-semibold);
	}

	.pinned-text {
		font-size: var(--font-sm);
		color: var(--text-primary);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pinned-time {
		font-size: var(--font-xs);
		color: var(--text-muted);
	}
</style>
